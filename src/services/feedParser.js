const fs = require("fs");
const path = require("path");
const axios = require("axios");
const http = require("http");
const https = require("https");
const sax = require("sax");
const { PassThrough } = require("stream");
const { pipeline } = require("stream/promises");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

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
 * Stream‑parse an XML file and extract items.
 * @param {string} filePath - Path to the XML file (temporary).
 * @returns {Promise<Array>} Array of items with {title, description, url, country}
 */
function parseXmlFileStream(filePath) {
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
      } else if (
        currentJob &&
        ["TITLE", "DESCRIPTION", "URL", "COUNTRY"].includes(tagName)
      ) {
        currentTag = tagName;
        currentText = "";
      }
    });

    parser.on("text", (text) => {
      if (currentTag) {
        currentText += text;
      }
    });

    parser.on("closetag", (tagName) => {
      if (tagName === "job" && currentJob) {
        items.push({
          title: safeString(currentJob.TITLE || "", 1000),
          description: safeString(currentJob.DESCRIPTION || "", 2000),
          url: currentJob.URL || "",
          country: safeString(currentJob.COUNTRY || "", 100),
        });
        currentJob = null;
      } else if (currentJob && currentTag === tagName) {
        currentJob[currentTag] = currentText.trim();
        currentTag = null;
        currentText = "";
      }
    });

    parser.on("error", reject);
    parser.on("end", () => resolve(items));

    fs.createReadStream(filePath).pipe(parser);
  });
}

async function downloadFeedToTempFile(url) {
  const tempDir = path.join(__dirname, "../../temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempFile = path.join(
    tempDir,
    `feed_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.xml`
  );

  const response = await axios({
    method: "GET",
    url,
    responseType: "stream",
    timeout: 120000,
    headers: { "Accept-Encoding": "gzip, deflate, br" },
    httpAgent,
    httpsAgent,
  });

  const writer = fs.createWriteStream(tempFile);
  await pipeline(response.data, writer);
  console.log(
    `Downloaded feed to ${tempFile} (${fs.statSync(tempFile).size} bytes)`
  );
  return tempFile;
}

async function parseFeedFromUrl(url, retries = 2) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= retries) {
    try {
      const tempFile = await downloadFeedToTempFile(url);
      const items = await parseXmlFileStream(tempFile);
      fs.unlinkSync(tempFile);
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

async function parseFeedFromFile(filePath) {
  const items = await parseXmlFileStream(filePath);
  return items;
}

// Keep the old synchronous parser for backward compatibility (used by feed upload? Not needed but kept)
function parseXml(xmlData) {
  // This function is no longer used for large feeds; kept for small uploads
  const parser = require("fast-xml-parser");
  const { XMLParser } = parser;
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
        2000
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
      description: safeString(entry.summary || entry.content || "", 2000),
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
      description: safeString(item.description || "", 2000),
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
      description: safeString(job.DESCRIPTION || job.Description || "", 2000),
      url: job.URL || job.Url || job.url || "",
      country: safeString(job.COUNTRY || job.Country || "", 100),
    }));
  }
  const rootKey = Object.keys(parsed)[0];
  if (rootKey && parsed[rootKey] && typeof parsed[rootKey] === "object") {
    // Fallback extraction (kept simple)
    const items = [];
    for (const key in parsed[rootKey]) {
      const item = parsed[rootKey][key];
      if (item && typeof item === "object") {
        items.push({
          title: safeString(item.title || item.TITLE || "", 1000),
          description: safeString(
            item.description || item.DESCRIPTION || "",
            2000
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
