import {appendFile} from "node:fs/promises";
import {runCheck,type RunOptions} from "./core.js";
const input=(name:string,fallback="")=>process.env[`INPUT_${name.toUpperCase()}`]??fallback;
const bool=(name:string,fallback:boolean)=>["1","true","yes"].includes(input(name,String(fallback)).toLowerCase());
const failOn=(value:string):RunOptions["failOn"]=>({"new-critical":"NEW_CRITICAL","any-critical":"ANY_CRITICAL","serious-or-worse":"SERIOUS_OR_WORSE",none:"NONE"}[value] as RunOptions["failOn"]|undefined)??(()=>{throw new Error(`Unsupported fail-on value: ${value}`);})();
async function output(name:string,value:string|number){const file=process.env.GITHUB_OUTPUT;if(file)await appendFile(file,`${name}=${value}\n`);else console.log(`${name}=${value}`);}
try{
 const apiKey=input("API-KEY");if(!apiKey)throw new Error("api-key is required.");console.log(`::add-mask::${apiKey}`);
 const urls=input("URLS").split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(!urls.length)throw new Error("urls must contain at least one URL.");
 const result=await runCheck({apiKey,urls,failOn:failOn(input("FAIL-ON","new-critical")),setBaseline:bool("SET-BASELINE",false),timeoutMs:Number(input("WAIT-TIMEOUT-SECONDS","600"))*1000,apiBaseUrl:input("API-BASE-URL","https://api.wcagc.com"),context:{provider:"github",repo:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,runUrl:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:undefined}}, {fetch,sleep:ms=>new Promise(r=>setTimeout(r,ms)),now:Date.now});
 if(bool("ANNOTATIONS",true))for(const line of result.annotations)console.log(line);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,result.summary);
 const c=result.check.counts,n=result.check.newCounts;await output("verdict",result.check.verdict??"FAIL");await output("check-id",result.check.id);await output("critical-count",c.critical);await output("serious-count",c.serious);await output("moderate-count",c.moderate);await output("minor-count",c.minor);await output("new-critical-count",n?.critical??0);await output("report-url",result.check.appUrl);
 if(result.check.verdict!=="PASS")throw new Error(result.check.failureReason??`wcagc check ${result.check.id} returned FAIL.`);
}catch(error){const message=error instanceof Error?error.message:String(error);console.error(`::error title=wcagc CI check::${message.replace(/%/g,"%25").replace(/\r/g,"%0D").replace(/\n/g,"%0A")}`);process.exitCode=1;}
