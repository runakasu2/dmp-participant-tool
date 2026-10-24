// Run alone (without test runners) to reduce CPU contention. Never connects to Neon.
const {execFileSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runs={before:[],after:[]};
for(let trial=0;trial<3;trial++)for(const mode of ['before','after']){
 const args=[path.join(__dirname,'benchmark.cjs')];if(mode==='before')args.push('--baseline');else args.push('--indexes');
 // benchmark treats its first argument as an optional file; use a unique /tmp file.
 const output=path.join(require('node:os').tmpdir(),`dmp-perf-${process.pid}-${trial}-${mode}.json`);args.splice(1,0,output);
 execFileSync(process.execPath,args,{cwd:path.resolve(__dirname,'../..'),stdio:['ignore','ignore','inherit']});runs[mode].push(JSON.parse(fs.readFileSync(output,'utf8')));fs.unlinkSync(output);
 console.log(`Measured ${mode} trial ${trial+1}/3`);
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],metrics={};
for(const name of Object.keys(runs.before[0].metrics)){
 for(const mode of ['before','after'])for(const run of runs[mode])assert.equal(run.checks[name],runs.before[0].checks[name],name+' output changed');
 const before=median(runs.before.map(r=>r.metrics[name].medianMs)),after=median(runs.after.map(r=>r.metrics[name].medianMs));metrics[name]={beforeMs:before,afterMs:after,improvementPercent:Number(((before-after)/before*100).toFixed(1)),beforeQueries:runs.before[0].metrics[name].queries,afterQueries:runs.after[0].metrics[name].queries};
}
const report={baselineRef:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,method:'3 alternating trials; each median of 5 warm measurements; after includes migration 015 index',dataset:runs.before[0].dataset,metrics,checksIdentical:true,runs};if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify({metrics,checksIdentical:true},null,2));
