#!/usr/bin/env node
/**
 * ars-gateway — standalone ARS gateway process.
 *
 * Usage:
 *   ars-gateway --plugin ./plugins/neorental [--port 8808] [--host 0.0.0.0]
 */
import { startGatewayHttp } from './http.js';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pluginDir = argValue('--plugin');
if (!pluginDir) {
  console.error('Usage: ars-gateway --plugin <dir> [--port 8808] [--host 0.0.0.0]');
  process.exit(1);
}

startGatewayHttp({
  pluginDir,
  port: Number(argValue('--port') ?? 8808),
  host: argValue('--host'),
})
  .then(({ plugin, port }) => {
    console.log(
      `[ars-gateway] plugin "${plugin.name}" — ${plugin.agent.operations.length} operations — MCP at http://localhost:${port}/mcp (health: /healthz)`,
    );
  })
  .catch((err) => {
    console.error(`[ars-gateway] failed to start: ${(err as Error).message}`);
    process.exit(1);
  });
