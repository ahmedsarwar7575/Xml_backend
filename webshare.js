import { fetchProxiesForCountry } from "./src/services/webshare.js";

const proxies = await fetchProxiesForCountry("zj87sk4roje3yt8tj8cgatdii69m3lwcz4lh3l5c", "CA", 20);

console.log(proxies);