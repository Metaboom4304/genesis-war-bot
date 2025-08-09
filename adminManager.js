// adminManager.js
const ADMINS = [ '766057421' ]  // твои ID
function checkIfAdmin(id) {
  return ADMINS.includes(String(id))
}
module.exports = { checkIfAdmin }
