import {coverageDisclaimer,runCheck,type Dependencies,type RunOptions} from "./core.js";

export type CliEnvironment=Record<string,string|undefined>;
export type CliConfig=RunOptions;

export class CliConfigError extends Error{}

const failOnValues:Record<string,RunOptions["failOn"]>={
 "new-critical":"NEW_CRITICAL",
 "any-critical":"ANY_CRITICAL",
 "serious-or-worse":"SERIOUS_OR_WORSE",
 none:"NONE"
};

function required(env:CliEnvironment,name:string){const value=env[name]?.trim();if(!value)throw new CliConfigError(`${name} is required.`);return value;}
function booleanValue(value:string|undefined,name:string){if(value===undefined||value.trim()==="")return false;const normalized=value.trim().toLowerCase();if(normalized==="true"||normalized==="1")return true;if(normalized==="false"||normalized==="0")return false;throw new CliConfigError(`${name} must be true or false.`);}
function positiveSeconds(value:string|undefined){if(!value?.trim())return 600_000;const seconds=Number(value);if(!Number.isFinite(seconds)||seconds<=0)throw new CliConfigError("WCAGC_WAIT_TIMEOUT must be a positive number of seconds.");return Math.round(seconds*1000);}
function httpsUrl(value:string,name:string){try{const parsed=new URL(value);if(parsed.protocol!=="https:"&&parsed.hostname!=="localhost"&&parsed.hostname!=="127.0.0.1")throw new Error();return parsed.toString().replace(/\/$/,"");}catch{throw new CliConfigError(`${name} must be an absolute HTTPS URL.`);}}

export function parseCliEnvironment(env:CliEnvironment):CliConfig{
 const apiKey=required(env,"WCAGC_API_KEY");
 const urls=required(env,"WCAGC_URLS").split(/[\n,]/).map(value=>value.trim()).filter(Boolean);
 if(urls.length>20)throw new CliConfigError("WCAGC_URLS accepts at most 20 URLs.");
 for(const url of urls)httpsUrl(url,"WCAGC_URLS");
 const requestedFailOn=(env.WCAGC_FAIL_ON??"new-critical").trim().toLowerCase();
 const failOn=failOnValues[requestedFailOn];
 if(!failOn)throw new CliConfigError("WCAGC_FAIL_ON must be new-critical, any-critical, serious-or-worse, or none.");
 return {
  apiKey,
  urls,
  failOn,
  setBaseline:booleanValue(env.WCAGC_SET_BASELINE,"WCAGC_SET_BASELINE"),
  timeoutMs:positiveSeconds(env.WCAGC_WAIT_TIMEOUT??env.WCAGC_WAIT_TIMEOUT_SECONDS),
  apiBaseUrl:httpsUrl(env.WCAGC_API_BASE_URL?.trim()||"https://api.wcagc.com","WCAGC_API_BASE_URL"),
  context:{
   provider:"gitlab",
   repository:env.CI_PROJECT_PATH,
   ref:env.CI_COMMIT_REF_NAME,
   sha:env.CI_COMMIT_SHA,
   workflowRunUrl:env.CI_PIPELINE_URL
  }
 };
}

export function renderCliTable(config:CliConfig,result:Awaited<ReturnType<typeof runCheck>>){
 const {check}=result;const fresh=check.newCounts??{critical:0,serious:0,moderate:0,minor:0};
 return [
  "wcagc CI check",
  `Verdict: ${check.verdict??"FAIL"}`,
  check.baselineMissing?"Baseline: missing; NEW_CRITICAL fell back to ANY_CRITICAL.":"",
  "",
  "Severity  Findings  New",
  `Critical  ${check.counts.critical}         ${fresh.critical}`,
  `Serious   ${check.counts.serious}         ${fresh.serious}`,
  `Moderate  ${check.counts.moderate}         ${fresh.moderate}`,
  `Minor     ${check.counts.minor}         ${fresh.minor}`,
  "",
  `Report: ${check.appUrl}`,
  `URLs: ${config.urls.length}`,
  "",
  coverageDisclaimer
 ].filter((line,index,all)=>line!==""||all[index-1]!=="").join("\n");
}

export async function executeCli(env:CliEnvironment,deps:Dependencies,write:(value:string)=>void,writeError:(value:string)=>void){
 try{
  const config=parseCliEnvironment(env);
  const result=await runCheck(config,deps);
  write(renderCliTable(config,result));
  return result.check.verdict==="PASS"?0:1;
 }catch(error){
  const message=error instanceof Error?error.message:"Unknown wcagc CI error.";
  const safeMessage=env.WCAGC_API_KEY?message.replaceAll(env.WCAGC_API_KEY,"[REDACTED]"):message;
  writeError(`wcagc CI: ${safeMessage}`);
  return error instanceof CliConfigError?2:1;
 }
}
