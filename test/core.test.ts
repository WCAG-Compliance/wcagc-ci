import test from "node:test";
import assert from "node:assert/strict";
import {runCheck,renderAnnotations,renderSummary,type Check} from "../src/core.js";

const counts=(critical=0,serious=0,moderate=0,minor=0)=>({critical,serious,moderate,minor});
const terminal=(over:Partial<Check>={}):Check=>({id:"check-1",status:"COMPLETED",verdict:"PASS",failOn:"NEW_CRITICAL",baselineMissing:false,counts:counts(),newCounts:counts(),appUrl:"https://wcagc.com/ci/checks/check-1",...over});
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}

test("creates, polls with backoff, and renders an honest PASS report",async()=>{let now=0;const waits:number[]=[];const replies=[response({id:"check-1"},202),response(terminal({status:"RUNNING",verdict:null})),response(terminal({counts:counts(0,1),newCounts:counts()})),response([])];const result=await runCheck({apiKey:"secret",urls:["https://example.com"],failOn:"NEW_CRITICAL",setBaseline:false,timeoutMs:10000,apiBaseUrl:"https://wcagc.com"},{fetch:async()=>replies.shift()!,sleep:async ms=>{waits.push(ms);now+=ms;},now:()=>now});assert.equal(result.check.verdict,"PASS");assert.deepEqual(waits,[1000]);assert.match(result.summary,/Automated checks cover only part of WCAG/);assert.doesNotMatch(result.summary,/compliant/i);});

test("times out without fetching findings",async()=>{let now=0,calls=0;await assert.rejects(()=>runCheck({apiKey:"secret",urls:["https://example.com"],failOn:"NONE",setBaseline:false,timeoutMs:1000,apiBaseUrl:"https://wcagc.com"},{fetch:async()=>{calls++;return calls===1?response({id:"check-1"},202):response(terminal({status:"RUNNING",verdict:null}));},sleep:async ms=>{now+=ms;},now:()=>now}),/Timed out/);assert.equal(calls,3);});

test("surfaces API problem without leaking the key",async()=>{await assert.rejects(()=>runCheck({apiKey:"super-secret",urls:["https://elsewhere.test"],failOn:"NONE",setBaseline:false,timeoutMs:1000,apiBaseUrl:"https://wcagc.com"},{fetch:async()=>response({code:"INVALID_URL"},422),sleep:async()=>{},now:()=>0}),error=>error instanceof Error&&error.message.includes("INVALID_URL")&&!error.message.includes("super-secret"));});

test("annotations map severity and escape workflow commands",()=>{const lines=renderAnnotations([{ruleId:"image-alt",impact:"critical",wcagSc:["1.1.1"],url:"https://example.com/a,b",helpUrl:"https://help",target:"img",failureSummary:"bad\nalt",isNew:true},{ruleId:"region",impact:"minor",wcagSc:[],url:"https://example.com",helpUrl:"",target:"main",isNew:false}]);assert.match(lines[0],/^::error/);assert.match(lines[0],/%0A/);assert.match(lines[0],/%2C/);assert.match(lines[1],/^::notice/);});

test("summary explains missing-baseline fallback",()=>{const md=renderSummary(terminal({verdict:"FAIL",baselineMissing:true,counts:counts(1),newCounts:counts(1)}));assert.match(md,/fell back to ANY_CRITICAL/);assert.match(md,/\| Critical \| 1 \| 1 \|/);});
