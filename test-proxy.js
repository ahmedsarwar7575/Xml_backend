const proxyProvider = require("./src/services/proxyProvider");

const func = async () => {
  const status = proxyProvider.getStatus();
  const proxies = await proxyProvider.fetchProxiesFromProvider(
    "novaproxy",
    "CA",
    1
  );
  console.log(proxies);
  console.log(status);
  return status;
};

func();