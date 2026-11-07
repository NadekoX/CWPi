export {};

process.env.CWPI_DATABASE_PATH ??= "../../.CWPi/harness.sqlite";
await import("./bootstrap.js");
