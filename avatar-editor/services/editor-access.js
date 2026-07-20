"use strict";
const createDirectusClient=require("../../lib/directus-client");
function role(){return String(process.env.AVATAR_EDITOR_ROLE_ID||"1").trim()}
async function findAuthorizedEmployee(telegramId){const c=createDirectusClient({directusUrl:process.env.DIRECTUS_URL,directusToken:process.env.DIRECTUS_TOKEN});const r=await c.get("/items/animals_team",{filter:{telegram_id:{_eq:String(telegramId)},is_active:{_eq:true},role_id:{_eq:role()}},fields:"id,full_name",limit:1});return Array.isArray(r.data)&&r.data[0]||null}
async function canEditAvatars(telegramId){return Boolean(await findAuthorizedEmployee(telegramId))}
async function canUseInternalTools(telegramId){return canEditAvatars(telegramId)}
async function getToolPermissions(telegramId){return await canUseInternalTools(telegramId)?["avatars","partners","media"]:[]}
module.exports={findAuthorizedEmployee,canEditAvatars,canUseInternalTools,getToolPermissions};
