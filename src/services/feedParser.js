const fs = require("fs");
const path = require("path");
const axios = require("axios");
const http = require("http");
const https = require("https");
const sax = require("sax");
const { pipeline } = require("stream/promises");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Hard char limits per tag — text beyond these is discarded immediately in the SAX text handler.
const TAG_LIMITS = {
  TITLE: 1000,
  DESCRIPTION: 1000,
  URL: 500,
  COUNTRY: 100,
};

function safeString(value, maxLen) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return str.length > maxLen ? str.substring(0, maxLen) : str;
}

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

/**
 * Core SAX parser — accepts any readable stream (file or HTTP response).
 * Constant memory regardless of file size.
 */
function parseXmlStream(readableStream) {
  return new Promise((resolve, reject) => {
    const items = [];
    let currentJob = null;
    let currentTag = null;
    let currentText = "";

    const parser = sax.createStream(true, {
      trim: true,
      normalize: true,
      lowercase: false,
    });

    parser.on("opentag", (node) => {
      const tagName = node.name;
      if (tagName === "job") {
        currentJob = {};
      } else if (currentJob && TAG_LIMITS[tagName] !== undefined) {
        currentTag = tagName;
        currentText = "";
      }
    });

    parser.on("text", (text) => {
      if (!currentTag) return;
      const limit = TAG_LIMITS[currentTag];
      const remaining = limit - currentText.length;
      if (remaining <= 0) return; // already full — discard, no string growth
      currentText +=
        remaining >= text.length ? text : text.substring(0, remaining);
    });

    parser.on("closetag", (tagName) => {
      if (tagName === "job" && currentJob) {
        items.push({
          title: currentJob.TITLE || "",
          description: currentJob.DESCRIPTION || "",
          url: currentJob.URL || "",
          country: currentJob.COUNTRY || "",
        });
        currentJob = null;
      } else if (currentJob && currentTag === tagName) {
        currentJob[currentTag] = currentText.trim();
        currentTag = null;
        currentText = "";
      }
    });

    // SAX strict mode throws on malformed XML — recover and continue
    parser.on("error", (err) => {
      console.warn(`SAX warning (skipping): ${err.message}`);
      parser._parser.error = null;
      parser._parser.resume();
    });

    parser.on("end", () => resolve(items));
    readableStream.on("error", reject);
    readableStream.pipe(parser);
  });
}


async function parseFeedFromUrl(url, retries = 2) {
  console.log(`parseFeedFromUrl: parsing ${url}`);
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const response = await axios({
        method: "GET",
        url,
        responseType: "stream", // ← THIS IS THE CRITICAL LINE. DO NOT REMOVE.
        timeout: 600000, // 10 min — needed for 2GB+ feeds
        headers: { "Accept-Encoding": "gzip, deflate, br" },
        httpAgent,
        httpsAgent,
      });

      const items = await parseXmlStream(response.data);
      console.log(`parseFeedFromUrl: parsed ${items.length} items from ${url}`);
      return items;
    } catch (err) {
      lastError = err;
      console.warn(`Attempt ${attempt + 1} failed for ${url}: ${err.message}`);
      attempt++;
      if (attempt <= retries) await new Promise((r) => setTimeout(r, 5000));
    }
  }

  throw lastError;
}

/**
 * Parse a local XML file — streams from disk, works on any file size.
 */
async function parseFeedFromFile(filePath) {
  const items = await parseXmlStream(fs.createReadStream(filePath));
  console.log(
    `parseFeedFromFile: parsed ${items.length} items from ${filePath}`
  );
  return items;
}

/**
 * Synchronous parser for small in-memory XML strings only (feed uploads etc).
 * Do NOT pass large responses here.
 */
function parseXml(xmlData) {
  const { XMLParser } = require("fast-xml-parser");
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: true,
    trimValues: true,
    allowBooleanAttributes: true,
    processEntities: {
      enabled: true,
      maxEntityCount: 20000,
      maxEntitySize: 10000,
      maxExpansionDepth: 10000,
      maxTotalExpansions: 200000,
      maxExpandedLength: 500000,
    },
  });

  const parsed = xmlParser.parse(xmlData);
  if (parsed["?xml"]) delete parsed["?xml"];

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

  if (parsed["rdf:RDF"]) {
    const rdf = parsed["rdf:RDF"];
    if (!rdf) return [];
    let items = rdf.item || [];
    if (!Array.isArray(items)) items = [items];
    return items.map((item) => ({
      title: safeString(item.title || "", 1000),
      description: safeString(item.description || "", 1000),
      url: item.link || "",
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

  const rootKey = Object.keys(parsed)[0];
  if (rootKey && parsed[rootKey] && typeof parsed[rootKey] === "object") {
    const items = [];
    for (const key in parsed[rootKey]) {
      const item = parsed[rootKey][key];
      if (item && typeof item === "object") {
        items.push({
          title: safeString(item.title || item.TITLE || "", 1000),
          description: safeString(
            item.description || item.DESCRIPTION || "",
            1000
          ),
          url: item.link || item.url || item.URL || "",
          country: safeString(item.country || item.COUNTRY || "", 100),
        });
      }
    }
    if (items.length) return items;
  }

  throw new Error(
    `Unsupported feed format. Root keys: ${Object.keys(parsed).join(", ")}`
  );
}

module.exports = { parseFeedFromUrl, parseFeedFromFile, parseXml };
