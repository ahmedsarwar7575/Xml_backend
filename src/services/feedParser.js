const fs = require("fs");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
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

function extractItemsFromData(dataObj) {
  if (Array.isArray(dataObj)) {
    return dataObj.map((item) => ({
      title: safeString(item.title || item.TITLE || "", 1000),
      description: safeString(item.description || item.DESCRIPTION || "", 5000),
      url: item.link || item.url || item.URL || "",
    }));
  }
  const possibleContainers = [
    "item",
    "items",
    "entry",
    "entries",
    "record",
    "records",
    "post",
    "posts",
    "node",
    "nodes",
    "job",
    "jobs",
  ];
  for (const container of possibleContainers) {
    if (dataObj[container]) {
      let items = dataObj[container];
      if (!Array.isArray(items)) items = [items];
      return items.map((item) => ({
        title: safeString(item.title || item.TITLE || "", 1000),
        description: safeString(
          item.description || item.DESCRIPTION || "",
          5000
        ),
        url: item.link || item.url || item.URL || "",
      }));
    }
  }
  const items = [];
  for (const key in dataObj) {
    if (
      Object.prototype.hasOwnProperty.call(dataObj, key) &&
      typeof dataObj[key] === "object" &&
      !Array.isArray(dataObj[key]) &&
      dataObj[key] !== null
    ) {
      const item = dataObj[key];
      items.push({
        title: safeString(item.title || item.TITLE || key, 1000),
        description: safeString(
          item.description || item.DESCRIPTION || "",
          5000
        ),
        url: item.link || item.url || item.URL || "",
      });
    } else if (Array.isArray(dataObj[key])) {
      for (const subItem of dataObj[key]) {
        items.push({
          title: safeString(subItem.title || subItem.TITLE || "", 1000),
          description: safeString(
            subItem.description || subItem.DESCRIPTION || "",
            5000
          ),
          url: subItem.link || subItem.url || subItem.URL || "",
        });
      }
    }
  }
  return items;
}

function parseRss(parsed) {
  const channel = parsed.rss?.channel;
  if (!channel) return [];
  let items = channel.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.map((item) => ({
    title: safeString(item.title || "", 1000),
    description: safeString(
      item.description || item["content:encoded"] || "",
      5000
    ),
    url: item.link || item.guid || "",
  }));
}

function parseAtom(parsed) {
  const feed = parsed.feed;
  if (!feed) return [];
  let entries = feed.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries.map((entry) => ({
    title: safeString(entry.title || "", 1000),
    description: safeString(entry.summary || entry.content || "", 5000),
    url: normalizeLink(entry.link),
  }));
}

function parseRdf(parsed) {
  const rdf = parsed["rdf:RDF"];
  if (!rdf) return [];
  let items = rdf.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.map((item) => ({
    title: safeString(item.title || "", 1000),
    description: safeString(item.description || "", 5000),
    url: item.link || "",
  }));
}

function parseSource(parsed) {
  const source = parsed.source || parsed.Source;
  if (!source) return [];
  let jobs = source.job || source.Job || [];
  if (!Array.isArray(jobs)) jobs = [jobs];
  return jobs.map((job) => ({
    title: safeString(job.TITLE || job.Title || "", 1000),
    description: safeString(job.DESCRIPTION || job.Description || "", 5000),
    url: job.URL || job.Url || job.url || "",
    country: safeString(job.COUNTRY || job.Country || "", 100),
  }));
}

function parseXml(xmlData) {
  const parsed = parser.parse(xmlData);
  if (parsed["?xml"]) delete parsed["?xml"];
  if (parsed.rss) return parseRss(parsed);
  if (parsed.feed) return parseAtom(parsed);
  if (parsed["rdf:RDF"]) return parseRdf(parsed);
  if (parsed.source || parsed.Source) return parseSource(parsed);
  const rootKey = Object.keys(parsed)[0];
  if (rootKey && parsed[rootKey] && typeof parsed[rootKey] === "object") {
    const items = extractItemsFromData(parsed[rootKey]);
    if (items.length) return items;
  }
  throw new Error(
    `Unsupported feed format. Root keys: ${Object.keys(parsed).join(", ")}`
  );
}

async function parseFeedFromUrl(url, retries = 2) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const response = await axios.get(url, {
        timeout: 180000, // 2 minutes
        maxContentLength: Infinity,
        responseType: 'text',
        decompress: true,
        onDownloadProgress: (progressEvent) => {
          // Optional: log progress for very large files
          if (progressEvent.total) {
            const percent = (progressEvent.loaded / progressEvent.total * 100).toFixed(2);
            console.log(`Downloading feed: ${percent}%`);
          }
        }
      });
      return parseXml(response.data);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message.includes('aborted')) {
        console.warn(`Attempt ${attempt + 1} aborted, retrying...`);
        attempt++;
        if (attempt > retries) throw new Error(`Feed download failed after ${retries + 1} attempts: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000)); // wait 5 seconds before retry
      } else {
        throw err;
      }
    }
  }
}

async function parseFeedFromFile(filePath) {
  const xmlData = fs.readFileSync(filePath, "utf8");
  return parseXml(xmlData);
}

module.exports = { parseFeedFromUrl, parseFeedFromFile };
