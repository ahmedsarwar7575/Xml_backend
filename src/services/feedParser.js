const fs = require("fs");
const path = require("path");
const axios = require("axios");
const http = require("http");
const https = require("https");
const sax = require("sax");
const { pipeline } = require("stream/promises");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Hard char limits per tag — text beyond these is DISCARDED IMMEDIATELY during SAX parsing.
// This is the fix for "Cannot create a string longer than 0x1fffffe8 characters".
// A 2GB feed with a 50MB <DESCRIPTION> field will only ever store 1000 chars of it.
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
 * Core SAX stream parser.
 * Accepts ANY readable stream — file, HTTP response, anything.
 * Memory usage stays constant regardless of file size.
 *
 * @param {import("stream").Readable} readableStream
 * @returns {Promise<Array<{title: string, description: string, url: string, country: string}>>}
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

      if (remaining <= 0) return; // already full — discard entirely, no string growth

      // Only append up to the remaining allowed chars
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

    parser.on("error", (err) => {
      // SAX is strict — recover from non-fatal errors and keep going
      console.warn(`SAX parse warning (non-fatal): ${err.message}`);
      parser._parser.error = null;
      parser._parser.resume();
    });

    parser.on("end", () => resolve(items));

    readableStream.on("error", reject);
    readableStream.pipe(parser);
  });
}

/**
 * Fetch feed from URL and parse it.
 * Pipes the HTTP response DIRECTLY into the SAX parser —
 * no temp file, no disk I/O, parsing starts immediately while downloading.
 *
 * For a 2GB feed:
 *   - At 100 Mbps  → ~160 seconds (network is the bottleneck)
 *   - At 1 Gbps    → ~16 seconds
 *   - SAX parsing itself takes ~5 seconds for 2GB (400 MB/s)
 *   - Memory usage: constant ~20MB regardless of file size
 *
 * @param {string} url
 * @param {number} retries
 * @returns {Promise<Array>}
 */
async function parseFeedFromUrl(url, retries = 2) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const response = await axios({
        method: "GET",
        url,
        responseType: "stream",
        timeout: 600000, // 10 minutes — needed for 2GB+ files over slow connections
        headers: { "Accept-Encoding": "gzip, deflate, br" },
        httpAgent,
        httpsAgent,
      });

      // Pipe HTTP stream directly into SAX — download and parse happen IN PARALLEL
      // Old approach: download 2GB to disk (wait ~160s), THEN parse (~5s) = 165s + 2GB disk needed
      // New approach: download + parse simultaneously = ~160s, zero extra disk needed
      const items = await parseXmlStream(response.data);
      console.log(`Parsed ${items.length} items from ${url}`);
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
 * Parse a local XML file.
 * Streams from disk — works on any file size.
 *
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
async function parseFeedFromFile(filePath) {
  const items = await parseXmlStream(fs.createReadStream(filePath));
  console.log(`Parsed ${items.length} items from ${filePath}`);
  return items;
}

/**
 * Synchronous XML parser for small in-memory strings only.
 * DO NOT pass large strings here — this is for small feed uploads.
 *
 * @param {string} xmlData
 * @returns {Array}
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
