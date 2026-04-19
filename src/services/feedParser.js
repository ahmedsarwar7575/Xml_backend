const fs = require("fs");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  allowBooleanAttributes: true,

  // Updated entity settings for newer fast-xml-parser versions
  processEntities: {
    enabled: true,
    maxEntityCount: 20000,
    maxEntitySize: 10000,
    maxExpansionDepth: 10000,
    maxTotalExpansions: 50000,
    maxExpandedLength: 500000,
  },
});

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
      title: item.title || item.TITLE || "",
      description: item.description || item.DESCRIPTION || "",
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
        title: item.title || item.TITLE || "",
        description: item.description || item.DESCRIPTION || "",
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
        title: item.title || item.TITLE || key,
        description: item.description || item.DESCRIPTION || "",
        url: item.link || item.url || item.URL || "",
      });
    } else if (Array.isArray(dataObj[key])) {
      for (const subItem of dataObj[key]) {
        items.push({
          title: subItem.title || subItem.TITLE || "",
          description: subItem.description || subItem.DESCRIPTION || "",
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
    title: item.title || "",
    description: item.description || item["content:encoded"] || "",
    url: item.link || item.guid || "",
  }));
}

function parseAtom(parsed) {
  const feed = parsed.feed;
  if (!feed) return [];

  let entries = feed.entry || [];
  if (!Array.isArray(entries)) entries = [entries];

  return entries.map((entry) => ({
    title: entry.title || "",
    description: entry.summary || entry.content || "",
    url: normalizeLink(entry.link),
  }));
}

function parseRdf(parsed) {
  const rdf = parsed["rdf:RDF"];
  if (!rdf) return [];

  let items = rdf.item || [];
  if (!Array.isArray(items)) items = [items];

  return items.map((item) => ({
    title: item.title || "",
    description: item.description || "",
    url: item.link || "",
  }));
}

function parseSource(parsed) {
  const source = parsed.source || parsed.Source;
  if (!source) return [];

  let jobs = source.job || source.Job || [];
  if (!Array.isArray(jobs)) jobs = [jobs];

  return jobs.map((job) => ({
    title: job.TITLE || job.Title || "",
    description: job.DESCRIPTION || job.Description || "",
    url: job.URL || job.Url || job.url || "",
    country: job.COUNTRY || job.Country || "",
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

async function parseFeedFromUrl(url) {
  const response = await axios.get(url, { timeout: 30000 });
  return parseXml(response.data);
}

async function parseFeedFromFile(filePath) {
  const xmlData = fs.readFileSync(filePath, "utf8");
  return parseXml(xmlData);
}

module.exports = { parseFeedFromUrl, parseFeedFromFile };
