export type SeverityCounts={critical:number;serious:number;moderate:number;minor:number};
export type Check={id:string;status:"QUEUED"|"RUNNING"|"COMPLETED"|"FAILED";verdict:"PASS"|"FAIL"|null;failOn:string;baselineMissing:boolean;counts:SeverityCounts;newCounts:SeverityCounts;appUrl:string;failureReason?:string|null};
export type Finding={ruleId:string;impact:"critical"|"serious"|"moderate"|"minor";wcagSc:string[];url:string;helpUrl:string;target:string;failureSummary?:string|null;isNew:boolean};
export type FetchLike=typeof fetch;
export interface RunOptions{apiKey:string;urls:string[];failOn:"NEW_CRITICAL"|"ANY_CRITICAL"|"SERIOUS_OR_WORSE"|"NONE";setBaseline:boolean;timeoutMs:number;apiBaseUrl:string;context?:Record<string,unknown>}
export interface Dependencies{fetch:FetchLike;sleep:(ms:number)=>Promise<void>;now:()=>number}
export interface Result{check:Check;findings:Finding[];summary:string;annotations:string[]}
const coverage="Automated checks cover only part of WCAG and EN 301 549. Manual review and fixes in code remain essential.";

function endpoint(base:string,path:string){return base.replace(/\/$/,"")+"/api/v1"+path;}
async function json<T>(response:Response):Promise<T>{if(!response.ok){const body=await response.text();throw new Error(`wcagc API ${response.status}: ${body.slice(0,500)}`);}return response.json() as Promise<T>;}
function headers(key:string){return {authorization:`Bearer ${key}`,"content-type":"application/json",accept:"application/json"};}
export async function runCheck(options:RunOptions,deps:Dependencies):Promise<Result>{
 const created=await json<{id:string}>(await deps.fetch(endpoint(options.apiBaseUrl,"/ci/checks"),{method:"POST",headers:headers(options.apiKey),body:JSON.stringify({urls:options.urls,failOn:options.failOn,setBaseline:options.setBaseline,context:options.context??{provider:"github"}})}));
 const started=deps.now();let delay=1000;let check:Check;
 for(;;){check=await json<Check>(await deps.fetch(endpoint(options.apiBaseUrl,`/ci/checks/${created.id}`),{headers:headers(options.apiKey)}));if(check.status==="COMPLETED"||check.status==="FAILED")break;if(deps.now()-started>=options.timeoutMs)throw new Error(`Timed out waiting for wcagc check ${created.id}.`);await deps.sleep(delay);delay=Math.min(5000,Math.ceil(delay*1.6));}
 const findings=await json<Finding[]>(await deps.fetch(endpoint(options.apiBaseUrl,`/ci/checks/${created.id}/violations`),{headers:headers(options.apiKey)}));
 return {check,findings,summary:renderSummary(check),annotations:renderAnnotations(findings)};
}
export function renderSummary(c:Check){const n=c.newCounts??{critical:0,serious:0,moderate:0,minor:0};return `# wcagc CI check\n\n**Verdict: ${c.verdict??"FAIL"}**${c.baselineMissing?" — no baseline; NEW_CRITICAL fell back to ANY_CRITICAL.":""}\n\n| Severity | Findings | New |\n|---|---:|---:|\n| Critical | ${c.counts.critical} | ${n.critical} |\n| Serious | ${c.counts.serious} | ${n.serious} |\n| Moderate | ${c.counts.moderate} | ${n.moderate} |\n| Minor | ${c.counts.minor} | ${n.minor} |\n\n[Open the wcagc report](${c.appUrl})\n\n> ${coverage}\n`;}
export function renderAnnotations(findings:Finding[]){return findings.map(f=>{const level=f.impact==="critical"||f.impact==="serious"?"error":f.impact==="moderate"?"warning":"notice";const fresh=f.isNew?"New ":"";return `::${level} title=${escape(`${fresh}${f.impact}: ${f.ruleId}`)}::${escape(`${f.url} — ${f.failureSummary??f.target??"Automated finding"}`)}`;});}
export function escape(value:string){return value.replace(/%/g,"%25").replace(/\r/g,"%0D").replace(/\n/g,"%0A").replace(/:/g,"%3A").replace(/,/g,"%2C");}
export {coverage as coverageDisclaimer};
