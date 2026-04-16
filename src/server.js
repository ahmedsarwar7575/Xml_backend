require('dotenv').config();
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const db = require('./db/init');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/feeds', require('./routes/feeds'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/proxies', require('./routes/proxies'));
app.use('/api/clicks', require('./routes/clicks'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.get("/data.xml", (req, res) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<source>
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
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close();
  process.exit(0);
});