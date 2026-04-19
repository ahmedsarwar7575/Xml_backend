const xmlsFeed = async (req, res) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <source>  
    <job>
      <Job-Nr>QTJ76825503</Job-Nr>
      <TITLE>Frontend Developer 27.02.2023</TITLE>
      <DESCRIPTION>QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
      <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.3AQTJ76825503/354</URL>
      <CITY>Braunschweig</CITY>
      <REGION>Niedersachsen</REGION>
      <POSTALCODE/>
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
      <Job-Nr>QTJ82543297</Job-Nr>
      <TITLE>New Senior Frontend Developer 01.03.2023</TITLE>
      <DESCRIPTION>QuickToJobs Stellenmarkt hilft dir dabei sicherzustellen, dass du den richtigen Job beim richtigen Arbeitgeber in unserer Jobbörse findest.&lt;br /&gt;Täglich neue Stellenangebote – Jobs für Fach Führungskräfte – Festanstellungen in Voll Teilzeit. Weiterbildung Jobs für Berufseinsteiger – Ausbildungsplätze.&lt;br /&gt;Finden sie hier ihren Traumjob.&lt;br /&gt;Bei uns finden sie den passenden Job für sich. Viele Stellenangebote aus Ihrer Region. Top Arbeitgeber. Jobs in Deutschland. Top Jobs. Kostenlose Jobsuche.</DESCRIPTION>
      <URL>https://www.quicktojobs.com/marketplace/partnerclicks/Job-Nr.3AQTJ82543297/354</URL>
      <CITY>Salzgitter</CITY>
      <REGION>Niedersachsen</REGION>
      <POSTALCODE/>
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
};

module.exports = xmlsFeed;