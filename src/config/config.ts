interface Config {
  apiBaseUrl: string;
  defaultBucket: string;
  defaultPrefix: string;
}

const config: Config = {
  apiBaseUrl: "http://localhost:3000",
  defaultBucket: "Sam & Sami",
  defaultPrefix: "Wedding",
};

export default config;
