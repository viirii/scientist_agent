import {longTermGoal} from '../mission.js';
import {strategyConfig,strategyFeedback,strategyProperties} from './strategy.js';
import {reasoningBudget} from './loop.js';
import {validate} from './contracts.js';
import {ReplayError} from '../errors.js';
const text={type:'string',minLength:1,maxLength:700};
export const strategyReviewSchema={type:'object',properties:{decision:{type:'string',enum:['keep','change']},config:{type:'object',properties:strategyProperties,required:Object.keys(strategyProperties),additionalProperties:false},reason:text,expected_benefit:text},required:['decision','config','reason','expected_benefit'],additionalProperties:false};
export async function reviewStrategy(pair,model,record,persist){
 if(!pair.modelConfig?.monthlyStrategyReview)return;
 pair.strategyReviews||={};if(pair.strategyReviews[pair.month]?.complete)return;
 const arm=pair.arms.find(a=>a.name==='recursive'),config=strategyConfig(arm.harness.config);
 const context={goal:longTermGoal,runFocus:pair.goal||longTermGoal,task:'Required monthly strategy review. Diagnose a concrete research-process bottleneck from the supplied process feedback. Explicitly choose keep or change. Keep must return the current config. Change must differ and explain how its expected benefit advances the supplied long-term research goal. Keep decisions must also explain why the current strategy still serves that goal. Do not force a change, invent scientific facts, use evaluator scores, or change immutable limits. This is a process decision, not proof of scientific improvement.',month:pair.month,currentStrategy:config,processFeedback:strategyFeedback(arm),openQuestions:arm.agenda||[]};
 const budget=arm.modelBudget[pair.month]||={calls:0,reservedTokenUnits:0};
 const limit=pair.modelConfig.executionOverrides?.callsPerMonth??reasoningBudget.callsPerMonth;
 const reserved=Buffer.byteLength(JSON.stringify(context)+JSON.stringify(strategyReviewSchema))+4000+reasoningBudget.outputTokens;
 if(budget.calls>=limit||budget.reservedTokenUnits+reserved>reasoningBudget.tokenUnitsPerMonth)throw new ReplayError('Monthly strategy review budget exhausted',429);
 budget.calls++;budget.reservedTokenUnits+=reserved;
 record(arm,pair,'model_request',{stage:'monthly_strategy_review',context,schema:strategyReviewSchema,reservedTokenUnits:reserved});await persist();
 let raw=false;
 const result=await model.complete({name:'monthly_strategy_review',schema:strategyReviewSchema,context,maxOutputTokens:reasoningBudget.outputTokens,onResponse:async response=>{raw=true;record(arm,pair,'raw_model_response',{stage:'monthly_strategy_review',response:structuredClone(response)});await persist();}});
 if(!raw){record(arm,pair,'raw_model_response',{stage:'monthly_strategy_review',response:structuredClone(result)});await persist();}
 validate(strategyReviewSchema,result.value);arm.usage.modelTokens+=result.tokens;
 const next=strategyConfig(result.value.config),changed=JSON.stringify(next)!==JSON.stringify(config);
 if(changed!==(result.value.decision==='change'))throw new ReplayError('Strategy review decision conflicts with its settings',422);
 if(changed){const parent=structuredClone(arm.harness);arm.harness={version:parent.version+1,config:next,parent,trial:true};record(arm,pair,'harness_promotion',{parent:parent.version,version:arm.harness.version,config:next,reason:result.value.reason,expectedBenefit:result.value.expected_benefit,origin:'monthly_strategy_review',validation:'Bounded process decision; execution trial next cycle, scientific benefit unmeasured.'});}
 const report={complete:true,...structuredClone(result.value),month:pair.month,previousVersion:changed?arm.harness.parent.version:arm.harness.version,version:arm.harness.version,processFeedback:context.processFeedback};pair.strategyReviews[pair.month]=report;record(arm,pair,'monthly_strategy_review',report);await persist();
}
