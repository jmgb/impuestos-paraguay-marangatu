import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { displayPeriod, periodStateKey } from "./core.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(rootDir, ".state");
const formStateFile = path.join(stateDir, "forms.json");
const emailStateFile = path.join(stateDir, "email-notifications.json");

const terminalStatuses = ["presentado", "sin-pendientes"];

async function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

// Escritura atómica: un corte a mitad nunca deja un JSON truncado, que
// bloquearía la protección contra presentaciones duplicadas.
async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

function loadFormState(filePath = formStateFile) {
  return readJsonObject(filePath);
}

function saveFormState(state, filePath = formStateFile) {
  return writeJsonAtomic(filePath, state);
}

async function getFormStatus(period, form, filePath = formStateFile) {
  const state = await loadFormState(filePath);
  return state[periodStateKey(period)]?.[form] ?? null;
}

async function setFormStatus(period, form, status, extra = {}, filePath = formStateFile) {
  const state = await loadFormState(filePath);
  const key = periodStateKey(period);
  state[key] = state[key] || {};
  state[key][form] = {
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  await saveFormState(state, filePath);
}

async function trySetFormStatus(period, form, status, extra, filePath) {
  await setFormStatus(period, form, status, extra, filePath).catch(error => {
    console.log(`No se pudo persistir estado '${status}' de ${form}: ${error.message}`);
  });
}

async function runFormWithStateTracking({ formName, period, submit, retryError = false, fn, stateFilePath = formStateFile }) {
  if (!submit) return fn();

  const previous = await getFormStatus(period, formName, stateFilePath);
  if (previous && terminalStatuses.includes(previous.status)) {
    console.log(`${formName}: ya tiene estado terminal '${previous.status}' para ${displayPeriod(period)}. Saltando para evitar duplicados.`);
    return { skipped: true, reason: previous.status };
  }
  if (previous?.status === "error" && !retryError) {
    throw new Error(`${formName}: estado 'error' previo para ${displayPeriod(period)}. Revise artifacts/ y autorice --retry-error ${formName} para reintentar.`);
  }

  await trySetFormStatus(period, formName, "iniciado", {}, stateFilePath);
  try {
    const result = await fn();
    await trySetFormStatus(period, formName, result?.stateStatus || "presentado", {}, stateFilePath);
    return result;
  } catch (error) {
    await trySetFormStatus(period, formName, "error", { error: error.message }, stateFilePath);
    throw error;
  }
}

export {
  rootDir,
  formStateFile,
  emailStateFile,
  readJsonObject,
  writeJsonAtomic,
  loadFormState,
  saveFormState,
  getFormStatus,
  setFormStatus,
  runFormWithStateTracking
};
