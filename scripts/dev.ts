const server = Bun.spawn(["bun", "--watch", "server/src/index.ts"], {
  stdio: ["inherit", "inherit", "inherit"],
});

const web = Bun.spawn(["bunx", "vite"], {
  cwd: "web",
  stdio: ["inherit", "inherit", "inherit"],
});

function shutdown(code = 0) {
  server.kill();
  web.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const exitCode = await Promise.race([server.exited, web.exited]);
shutdown(exitCode ?? 0);
