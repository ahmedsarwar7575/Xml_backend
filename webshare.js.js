const db = require("./src/db/init");
const {
  parseFeedFromUrl,
  parseFeedFromFile,
} = require("./src/services/feedParser");
const fs = require("fs");

async function reparseAllFeeds() {
  const feeds = db.prepare("SELECT id, source_type, source FROM feeds").all();
  console.log(`Found ${feeds.length} feeds to re-parse`);

  for (const feed of feeds) {
    console.log(`\nReparsing feed ${feed.id} (${feed.source_type})...`);
    try {
      let items;
      if (feed.source_type === "url") {
        items = await parseFeedFromUrl(feed.source);
      } else {
        if (!fs.existsSync(feed.source)) {
          console.log(`File not found: ${feed.source}, skipping`);
          continue;
        }
        items = await parseFeedFromFile(feed.source);
      }

      // Update each feed item with its country
      const updateStmt = db.prepare(
        "UPDATE feed_items SET country = ? WHERE id = ?"
      );
      const updateMany = db.transaction((itemRows) => {
        for (const item of itemRows) {
          updateStmt.run(item.country, item.id);
        }
      });

      // Get existing items for this feed
      const existingItems = db
        .prepare("SELECT id, title, url FROM feed_items WHERE feed_id = ?")
        .all(feed.id);
      if (existingItems.length !== items.length) {
        console.warn(
          `Warning: item count mismatch for feed ${feed.id}: DB has ${existingItems.length}, parsed has ${items.length}`
        );
      }

      // Match by URL (assuming unique URLs per feed)
      const updates = [];

      for (const existing of existingItems) {
        const matched = items.find((i) => i.url === existing.url);
        if (matched && matched.country) {
          updates.push({ id: existing.id, country: matched.country });
        }
      }
      updateMany(updates);
      console.log(`Updated ${JSON.stringify(updates)} items with country info`);
      console.log(`Updated ${updates.length} items with country info`);
    } catch (err) {
      console.error(`Failed to reparse feed ${feed.id}:`, err.message);
    }
  }
  console.log("\nDone.");
  process.exit(0);
}

reparseAllFeeds().catch(console.error);



app.get("/data.xml", (req, res) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <job>
    <Job-Nr>Job-Nr.:QTJ67008877</Job-Nr>
    <TITLE>Senior Frontend Developer 25.02.2023</TITLE>
    <DESCRIPTION>QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
    <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.%3AQTJ67008877/354</URL>
    <CITY>Goslar</CITY>
    <REGION>Niedersachsen</REGION>
    <POSTALCODE></POSTALCODE>
    <COUNTRY>Germany</COUNTRY>
    <COMPANY>QuickToJobs Team</COMPANY>
    <DATE>2023-02-25 00:00:00</DATE>
    <JobType>Vollzeit</JobType>
    <LOGO>https://de.quicktojobs.com/company_logos/quicktojobs-team-1668546329-489.png</LOGO>
    <CATEGORY>Administration</CATEGORY>
    <LAT>51.906</LAT>
    <LON>10.4292</LON>
    <CPC>0.15</CPC>
  </job>

  <job>
    <Job-Nr>Job-Nr.:QTJ75965438</Job-Nr>
    <TITLE>Senior Frontend Developer 27.02.2023</TITLE>
    <DESCRIPTION>&lt;br /&gt;QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
    <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.%3AQTJ75965438/354</URL>
    <CITY>Peine</CITY>
    <REGION>Niedersachsen</REGION>
    <POSTALCODE></POSTALCODE>
    <COUNTRY>Germany</COUNTRY>
    <COMPANY>QuickToJobs Team</COMPANY>
    <DATE>2023-02-27 00:00:00</DATE>
    <JobType>Vollzeit</JobType>
    <LOGO>https://de.quicktojobs.com/company_logos/quicktojobs-team-1668546329-489.png</LOGO>
    <CATEGORY>Administration</CATEGORY>
    <LAT>52.3203</LAT>
    <LON>10.2336</LON>
    <CPC>0.15</CPC>
  </job>

  <job>
    <Job-Nr>Job-Nr.:QTJ76825503</Job-Nr>
    <TITLE>Frontend Developer 27.02.2023</TITLE>
    <DESCRIPTION>QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
    <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.%3AQTJ76825503/354</URL>
    <CITY>Braunschweig</CITY>
    <REGION>Niedersachsen</REGION>
    <POSTALCODE></POSTALCODE>
    <COUNTRY>Germany</COUNTRY>
    <COMPANY>QuickToJobs Team</COMPANY>
    <DATE>2023-02-27 00:00:00</DATE>
    <JobType>Vollzeit</JobType>
    <LOGO>https://de.quicktojobs.com/company_logos/quicktojobs-team-1668546329-489.png</LOGO>
    <CATEGORY>Administration</CATEGORY>
    <LAT>52.2692</LAT>
    <LON>10.5211</LON>
    <CPC>0.15</CPC>
  </job>

  <job>
    <Job-Nr>Job-Nr.:QTJ82543297</Job-Nr>
    <TITLE>New Senior Frontend Developer 01.03.2023</TITLE>
    <DESCRIPTION>QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
    <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.%3AQTJ82543297/354</URL>
    <CITY>Salzgitter</CITY>
    <REGION>Niedersachsen</REGION>
    <POSTALCODE></POSTALCODE>
    <COUNTRY>Germany</COUNTRY>
    <COMPANY>QuickToJobs Team</COMPANY>
    <DATE>2023-03-01 00:00:00</DATE>
    <JobType>Vollzeit</JobType>
    <LOGO>https://de.quicktojobs.com/company_logos/quicktojobs-team-1668546329-489.png</LOGO>
    <CATEGORY>Administration</CATEGORY>
    <LAT>52.1503</LAT>
    <LON>10.3593</LON>
    <CPC>0.15</CPC>
  </job>
</source>`;

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.send(xml);
});
