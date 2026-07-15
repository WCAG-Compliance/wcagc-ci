#!/usr/bin/env node
import {executeCli} from "./cli-core.js";

const exitCode=await executeCli(
 process.env,
 {fetch,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),now:Date.now},
 value=>process.stdout.write(`${value}\n`),
 value=>process.stderr.write(`${value}\n`)
);
process.exitCode=exitCode;
