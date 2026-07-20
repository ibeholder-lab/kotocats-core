"use strict";
const crypto=require("crypto");
const TTL=7*60*60*1000;
function secret(){const v=process.env.AVATAR_EDITOR_SESSION_SECRET;if(!v)throw Error("csrf_secret_missing");return v}
function createCsrfToken(identity,now=Date.now()){if(!Number.isSafeInteger(identity))throw Error("csrf_identity_invalid");const payload=Buffer.from(JSON.stringify({i:identity,n:crypto.randomBytes(24).toString("base64url"),e:now+TTL})).toString("base64url");const sig=crypto.createHmac("sha256",secret()).update(payload).digest("base64url");return payload+"."+sig}
function verifyCsrfToken(token,identity,now=Date.now()){if(!Number.isSafeInteger(identity)||typeof token!=="string")return false;const [p,s,...more]=token.split(".");if(!p||!s||more.length)return false;const expected=crypto.createHmac("sha256",secret()).update(p).digest("base64url"),a=Buffer.from(s),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return false;try{const x=JSON.parse(Buffer.from(p,"base64url").toString("utf8"));return x.i===identity&&Number.isSafeInteger(x.e)&&x.e>=now&&x.e<=now+TTL}catch{return false}}
function getOrCreateCsrfToken(req){return createCsrfToken(req.toolUser?.telegramId)}
function requireCsrf(req,res,next){if(["GET","HEAD","OPTIONS"].includes(req.method))return next();try{return verifyCsrfToken(req.get("x-csrf-token"),req.toolUser?.telegramId)?next():res.status(403).json({ok:false,error:"invalid_csrf"})}catch(e){return res.status(500).json({ok:false,error:"csrf_unavailable"})}}
module.exports={TTL,createCsrfToken,verifyCsrfToken,getOrCreateCsrfToken,requireCsrf};
