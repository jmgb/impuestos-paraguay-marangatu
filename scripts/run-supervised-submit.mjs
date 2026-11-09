#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { booleanValue, forms, periodStateKey, previousMonthPeriod } from "../src/core.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDir, "..");

class LauncherError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseLauncherArgs(argv) {
  const args = {
    confirmPeriod: "",
    checkOnly: false,
    forwardArgs: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-period") {
      if (argv[index + 1] === undefined) {
        throw new LauncherError("Falta el valor de --confirm-period.", 2);
      }
      args.confirmPeriod = argv[++index];
    } else if (["--skip-f120", "--skip-f241"].includes(argument)) {
      args.forwardArgs.push(argument);
    } else if (argument === "--retry-error") {
      if (argv[index + 1] === undefined) {
        throw new LauncherError("Falta el valor de --retry-error.", 2);
      }
      const form = argv[++index].toUpperCase();
      if (!forms.includes(form)) {
        throw new LauncherError("--retry-error solo acepta F120 o F241.", 2);
      }
      args.forwardArgs.push("--retry-error", form);
    } else if (argument === "--check") {
      args.checkOnly = true;
    } else {
      throw new LauncherError(`Argumento no permitido en modo submit: ${argument}`, 2);
    }
  }

  return args;
}

function validateLauncherConfig({ config, confirmPeriod, expectedPeriod }) {
  if (!config.MARANGATU_USER || !config.MARANGATU_PASSWORD) {
    throw new LauncherError("Las credenciales locales de Marangatu no están configuradas.", 4);
  }
  if (confirmPeriod !== expectedPeriod) {
    throw new LauncherError(
      `Confirmación inválida. Use --confirm-period ${expectedPeriod} para el mes anterior en Madrid.`,
      5
    );
  }
  if (booleanValue(config.MARANGATU_HEADLESS)) {
    throw new LauncherError("El modo submit supervisado requiere MARANGATU_HEADLESS=false.", 6);
  }
}

function resolveProjectRoot(environment = process.env) {
  return path.resolve(environment.MARANGATU_PROJECT_ROOT || defaultProjectRoot);
}

// Configuración efectiva del proceso hijo: como en dotenv, una variable ya
// presente en el entorno prevalece sobre el valor del .env.
function effectiveConfig(fileConfig, environment) {
  return { ...fileConfig, ...environment };
}

function loadPrivateConfig(projectRoot, environment = process.env) {
  const entrypoint = path.join(projectRoot, "src", "marangatu.js");
  const envFile = path.join(projectRoot, ".env");
  if (!fs.existsSync(entrypoint) || !fs.existsSync(envFile)) {
    throw new LauncherError("Proyecto Marangatu o archivo .env no encontrado en la ruta configurada.", 3);
  }
  return effectiveConfig(dotenv.parse(fs.readFileSync(envFile, "utf8")), environment);
}

function runLauncher(argv = process.argv.slice(2), environment = process.env) {
  const args = parseLauncherArgs(argv);
  const projectRoot = resolveProjectRoot(environment);
  const config = loadPrivateConfig(projectRoot, environment);
  const expectedPeriod = periodStateKey(previousMonthPeriod());
  validateLauncherConfig({
    config,
    confirmPeriod: args.confirmPeriod,
    expectedPeriod
  });

  if (args.checkOnly) {
    console.log(`Modo submit validado para ${expectedPeriod}; no se abrió Marangatu.`);
    return 0;
  }

  const child = spawnSync(process.execPath, [
    path.join(projectRoot, "src", "marangatu.js"),
    "--submit",
    "--confirm-period",
    args.confirmPeriod,
    ...args.forwardArgs
  ], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...environment, MARANGATU_SUBMIT: "true" }
  });

  if (child.error) {
    throw new LauncherError(`No se pudo iniciar el proceso supervisado: ${child.error.message}`, 7);
  }
  return typeof child.status === "number" ? child.status : 1;
}

const isCliRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCliRun) {
  try {
    process.exitCode = runLauncher();
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode || 1;
  }
}

export {
  LauncherError,
  effectiveConfig,
  parseLauncherArgs,
  validateLauncherConfig,
  resolveProjectRoot
};
