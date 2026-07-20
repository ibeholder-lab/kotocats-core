"use strict";
const {requireSession}=require("../avatar-editor/middleware/security");
const {findAuthorizedEmployee,getToolPermissions}=require("../avatar-editor/services/editor-access");
async function requireToolAuth(req,res,next){return requireSession(req,res,async()=>{try{const employee=await findAuthorizedEmployee(req.avatarEditor.telegramId);if(!employee)return res.status(403).json({ok:false,error:"forbidden"});req.toolUser={telegramId:req.avatarEditor.telegramId,employeeId:employee.id,displayName:employee.full_name,permissions:await getToolPermissions(req.avatarEditor.telegramId)};next()}catch(e){console.error("tools_access_check_failed",e.message);res.status(503).json({ok:false,error:"access_check_failed"})}})}
function requireToolPermission(permission){return(req,res,next)=>req.toolUser?.permissions.includes(permission)?next():res.status(403).json({ok:false,error:"forbidden"})}
const getCurrentToolUser=req=>req.toolUser||null;
module.exports={requireToolAuth,requireToolPermission,getCurrentToolUser};
