"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const express=require("express");
const media=require("../routes/media-likes");
const id="11111111-1111-4111-8111-111111111111";
function app(pool,opts={}){const a=express();a.set("trust proxy","loopback");a.use("/",media.createMediaLikesRouter({pool,secret:"x".repeat(32),logger:{info(){},warn(){},error(){}},...opts}));return a}
function request(a,path,method="GET",headers={}){return new Promise((resolve,reject)=>{const s=a.listen(0,"127.0.0.1",()=>{const q=http.request({port:s.address().port,path,method,headers},r=>{let b="";r.on("data",x=>b+=x);r.on("end",()=>{s.close();resolve({status:r.statusCode,body:JSON.parse(b),cookie:r.headers["set-cookie"]?.[0]})})});q.on("error",reject);q.end()})})}
test("exports ready router and factory",()=>{assert.equal(typeof media, "function");assert.equal(typeof media.createMediaLikesRouter,"function")});
test("GET deduplicates IDs in one query and sets secure cookie",async()=>{let calls=0;const r=await request(app({query:async()=>{calls++;return{rows:[{id,count:0,liked:false}]}}}),"/?media_ids="+id+","+id);assert.equal(r.status,200);assert.equal(calls,1);assert.equal(r.body.items[id].count,0);assert.match(r.cookie,/HttpOnly; Secure; SameSite=Lax/)});
test("invalid UUID and missing secret fail closed",async()=>{const pool={query:async()=>({rows:[]})};assert.equal((await request(app(pool),"/?media_ids=no")).status,400);const a=express();a.use(media.createMediaLikesRouter({pool,secret:""}));assert.equal((await request(a,"/?media_ids="+id)).status,503)});
