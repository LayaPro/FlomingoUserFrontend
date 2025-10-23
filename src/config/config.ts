interface Config {
  apiBaseUrl: string;
  defaultBucket: string;
  defaultPrefix: string;
}

const config: Config = {
  apiBaseUrl: "http://localhost:3000",
  // apiBaseUrl:
  //   "http://laya-bl-elastic-env.eba-t7qvcbrd.ap-south-1.elasticbeanstalk.com",
  defaultBucket: "Sam & Sami",
  defaultPrefix: "Wedding",
};

export default config;
