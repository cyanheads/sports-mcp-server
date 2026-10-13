/** Reports the actual Node executable without changing the server startup. */
process.stderr.write(
  `SPORTS_RUNTIME ${JSON.stringify({ executable: process.execPath, pid: process.pid })}\n`,
);
