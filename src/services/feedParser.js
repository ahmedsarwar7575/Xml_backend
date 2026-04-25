const fs = require("fs");
const axios = require("axios");
const http = require("http");
const https = require("https");
const sax = require("sax");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const TAG_LIMITS = {
  TITLE: 1000,
  DESCRIPTION: 1000,
  URL: 500,
  COUNTRY: 100,
  title: 1000,
  description: 1000,
  link: 500,
  guid: 500,
  country: 100,
  summary: 1000,
  "content:encoded": 1000,
};

function safeString(value, maxLen) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return str.length > maxLen ? str.substring(0, maxLen) : str;
}

function streamParseXml(readableStream, onItem) {
  return new Promise((resolve, reject) => {
    let currentItem = null;
    let currentTag = null;
    let currentText = "";
    let itemCount = 0;
    let itemTagName = null;

    const parser = sax.createStream(true, {
      trim: true,
      normalize: true,
      lowercase: false,
    });

    parser.on("opentag", (node) => {
      const tagName = node.name;

      if (!itemTagName) {
        if (tagName === "job" || tagName === "item" || tagName === "entry") {
          itemTagName = tagName;
          currentItem = {};
          return;
        }
      }

      if (itemTagName && tagName === itemTagName && !currentItem) {
        currentItem = {};
      } else if (currentItem && TAG_LIMITS[tagName] !== undefined) {
        currentTag = tagName;
        currentText = "";
      }
    });

    parser.on("text", (text) => {
      if (!currentTag) return;
      const limit = TAG_LIMITS[currentTag];
      const remaining = limit - currentText.length;
      if (remaining <= 0) return;
      currentText +=
        remaining >= text.length ? text : text.substring(0, remaining);
    });

    parser.on("cdata", (text) => {
      if (!currentTag) return;
      const limit = TAG_LIMITS[currentTag];
      const remaining = limit - currentText.length;
      if (remaining <= 0) return;
      currentText +=
        remaining >= text.length ? text : text.substring(0, remaining);
    });

    parser.on("closetag", (tagName) => {
      if (itemTagName && tagName === itemTagName && currentItem) {
        const item = {
          title: safeString(currentItem.TITLE || currentItem.title || "", 1000),
          description: safeString(
            currentItem.DESCRIPTION ||
              currentItem.description ||
              currentItem.summary ||
              currentItem["content:encoded"] ||
              "",
            1000
          ),
          url: safeString(
            currentItem.URL || currentItem.link || currentItem.guid || "",
            500
          ),
          country: safeString(
            currentItem.COUNTRY || currentItem.country || "",
            100
          ),
        };

        try {
          onItem(item);
          itemCount++;
        } catch (err) {
          console.error(`Item callback error: ${err.message}`);
        }

        currentItem = null;
        currentTag = null;
        currentText = "";
      } else if (currentItem && currentTag === tagName) {
        currentItem[currentTag] = currentText.trim();
        currentTag = null;
        currentText = "";
      }
    });

    parser.on("error", (err) => {
      console.warn(`SAX warning (skipping): ${err.message}`);
      parser._parser.error = null;
      parser._parser.resume();
    });

    parser.on("end", () => resolve(itemCount));
    readableStream.on("error", reject);
    readableStream.pipe(parser);
  });
}

async function streamParseFromUrl(url, onItem, retries = 2) {
  console.log(`Streaming feed from ${url}`);
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const response = await axios({
        method: "GET",
        url,
        responseType: "stream",
        timeout: 600000,
        headers: { "Accept-Encoding": "gzip, deflate, br" },
        httpAgent,
        httpsAgent,
      });

      const count = await streamParseXml(response.data, onItem);
      console.log(`Streamed ${count} items from ${url}`);
      return count;
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${attempt + 1} failed for ${url}: ${err.message}`);
      attempt++;
      if (attempt <= retries) await new Promise((r) => setTimeout(r, 5000));
    }
  }

  throw lastError;
}

async function streamParseFromFile(filePath, onItem) {
  const count = await streamParseXml(fs.createReadStream(filePath), onItem);
  console.log(`Streamed ${count} items from ${filePath}`);
  return count;
}

function parseFeedFromUrl(url, retries = 2) {
  return new Promise(async (resolve, reject) => {
    const items = [];
    try {
      await streamParseFromUrl(
        url,
        (item) => {
          items.push(item);
        },
        retries
      );
      resolve(items);
    } catch (err) {
      reject(err);
    }
  });
}

function parseFeedFromFile(filePath) {
  return new Promise(async (resolve, reject) => {
    const items = [];
    try {
      await streamParseFromFile(filePath, (item) => {
        items.push(item);
      });
      resolve(items);
    } catch (err) {
      reject(err);
    }
  });
}

function parseXml(xmlData) {
  const { XMLParser } = require("fast-xml-parser");
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: true,
    trimValues: true,
    allowBooleanAttributes: true,
  });

  const parsed = xmlParser.parse(xmlData);
  if (parsed["?xml"]) delete parsed["?xml"];

  function normalizeLink(link) {
    if (!link) return "";
    if (Array.isArray(link)) {
      const hrefLink = link.find((l) => typeof l === "object" && l["@_href"]);
      if (hrefLink) return hrefLink["@_href"];
      return typeof link[0] === "string" ? link[0] : "";
    }
    if (typeof link === "object") {
      return link["@_href"] || link.href || "";
    }
    return link;
  }

  if (parsed.rss) {
    const channel = parsed.rss?.channel;
    if (!channel) return [];
    let items = channel.item || [];
    if (!Array.isArray(items)) items = [items];
    return items.map((item) => ({
      title: safeString(item.title || "", 1000),
      description: safeString(
        item.description || item["content:encoded"] || "",
        1000
      ),
      url: item.link || item.guid || "",
    }));
  }

  if (parsed.feed) {
    const feed = parsed.feed;
    if (!feed) return [];
    let entries = feed.entry || [];
    if (!Array.isArray(entries)) entries = [entries];
    return entries.map((entry) => ({
      title: safeString(entry.title || "", 1000),
      description: safeString(entry.summary || entry.content || "", 1000),
      url: normalizeLink(entry.link),
    }));
  }

  if (parsed.source || parsed.Source) {
    const source = parsed.source || parsed.Source;
    if (!source) return [];
    let jobs = source.job || source.Job || [];
    if (!Array.isArray(jobs)) jobs = [jobs];
    return jobs.map((job) => ({
      title: safeString(job.TITLE || job.Title || "", 1000),
      description: safeString(job.DESCRIPTION || job.Description || "", 1000),
      url: job.URL || job.Url || job.url || "",
      country: safeString(job.COUNTRY || job.Country || "", 100),
    }));
  }

  throw new Error(
    `Unsupported feed format. Root keys: ${Object.keys(parsed).join(", ")}`
  );
}

module.exports = {
  parseFeedFromUrl,
  parseFeedFromFile,
  parseXml,
  streamParseFromUrl,
  streamParseFromFile,
};
