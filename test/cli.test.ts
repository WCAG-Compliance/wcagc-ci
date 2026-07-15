import assert from "node:assert/strict";
import test from "node:test";
import {executeCli,parseCliEnvironment} from "../src/cli-core.js";

const completed=(verdict:"PASS"|"FAIL")=>({
 id:"check-1",status:"COMPLETED",verdict,failOn:"NEW_CRITICAL",baselineMissing:false,
 counts:{critical:1,serious:2,moderate:3,minor:4},newCounts:{critical:0,serious:1,moderate:0,minor:0},
 appUrl:"https://app.wcagc.com/ci/checks/check-1"
});

function dependencies(verdict:"PASS"|"FAIL"="PASS"){
 let calls=0;
 const bodies:string[]=[];
 return {
  bodies,
  deps:{
   fetch:async (_input:URL|string|Request,init?:RequestInit)=>{
    calls+=1;if(init?.body)bodies.push(String(init.body));
    if(calls===1)return new Response(JSON.stringify({id:"check-1"}),{status:201});
    if(calls===2)return new Response(JSON.stringify(completed(verdict)),{status:200});
    return new Response(JSON.stringify([]),{status:200});
   },
   sleep:async()=>{},now:()=>0
  }
 };
}

test("parses the documented GitLab environment",()=>{
 const config=parseCliEnvironment({WCAGC_API_KEY:"secret",WCAGC_URLS:"https://example.com\nhttps://example.com/pricing",WCAGC_FAIL_ON:"serious-or-worse",WCAGC_SET_BASELINE:"true",WCAGC_WAIT_TIMEOUT:"45",WCAGC_API_BASE_URL:"https://api.example.test",CI_PROJECT_PATH:"group/project"});
 assert.deepEqual(config.urls,["https://example.com","https://example.com/pricing"]);
 assert.equal(config.failOn,"SERIOUS_OR_WORSE");assert.equal(config.setBaseline,true);assert.equal(config.timeoutMs,45_000);assert.equal(config.apiBaseUrl,"https://api.example.test");assert.deepEqual(config.context,{provider:"gitlab",repository:"group/project",ref:undefined,sha:undefined,workflowRunUrl:undefined});
});

test("prints a PASS table and coverage limitation without exposing the API key",async()=>{
 const {deps,bodies}=dependencies();const output:string[]=[];const errors:string[]=[];
 const code=await executeCli({WCAGC_API_KEY:"top-secret",WCAGC_URLS:"https://example.com",CI_PROJECT_PATH:"group/project",CI_COMMIT_REF_NAME:"feature",CI_COMMIT_SHA:"abc",CI_PIPELINE_URL:"https://gitlab.test/p/1"},deps,output.push.bind(output),errors.push.bind(errors));
 assert.equal(code,0);assert.equal(errors.length,0);assert.match(output[0],/Verdict: PASS/);assert.match(output[0],/Automated checks cover only part/);assert.doesNotMatch(output.join("\n"),/top-secret/);assert.match(bodies[0],/"provider":"gitlab"/);
});

test("returns 1 for a failing accessibility verdict",async()=>{
 const {deps}=dependencies("FAIL");const output:string[]=[];
 assert.equal(await executeCli({WCAGC_API_KEY:"secret",WCAGC_URLS:"https://example.com"},deps,output.push.bind(output),()=>{}),1);
 assert.match(output[0],/Verdict: FAIL/);
});

test("returns 2 for configuration errors before any API request",async()=>{
 let fetched=false;const errors:string[]=[];
 const code=await executeCli({WCAGC_URLS:"https://example.com"},{fetch:async()=>{fetched=true;return new Response();},sleep:async()=>{},now:()=>0},()=>{},errors.push.bind(errors));
 assert.equal(code,2);assert.equal(fetched,false);assert.match(errors[0],/WCAGC_API_KEY is required/);
});

test("rejects non-HTTPS target and API URLs as configuration errors",()=>{
 assert.throws(()=>parseCliEnvironment({WCAGC_API_KEY:"secret",WCAGC_URLS:"http://example.com"}),/WCAGC_URLS must be an absolute HTTPS URL/);
 assert.throws(()=>parseCliEnvironment({WCAGC_API_KEY:"secret",WCAGC_URLS:"https://example.com",WCAGC_API_BASE_URL:"not-a-url"}),/WCAGC_API_BASE_URL must be an absolute HTTPS URL/);
});

test("returns 1 for API errors and never includes the API key",async()=>{
 const errors:string[]=[];
 const code=await executeCli({WCAGC_API_KEY:"never-print-me",WCAGC_URLS:"https://example.com"},{fetch:async()=>new Response("diagnostic accidentally echoed never-print-me",{status:503}),sleep:async()=>{},now:()=>0},()=>{},errors.push.bind(errors));
 assert.equal(code,1);assert.match(errors[0],/wcagc API 503/);assert.doesNotMatch(errors[0],/never-print-me/);
});
