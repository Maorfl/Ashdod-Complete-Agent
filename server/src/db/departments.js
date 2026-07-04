/**
 * db/departments.js — DB לקוחות לכל מחלקה.
 * data/departments/cus1.json (משה רוסו), cus2.json (דורון רימה), cus3.json (אביהוא עבדי).
 * קבצי JSON לוקאליים. הניתוב למחלקה נקבע לפי עמודת Cust. Service rep He בדוח.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const DIR = path.join(DATA_DIR, 'departments');
const DEPTS = ['cus1', 'cus2', 'cus3'];

function file(dept) {
  return path.join(DIR, `${dept}.json`);
}

function read(dept) {
  const p = file(dept);
  if (!fs.existsSync(p)) return { department: dept, clients: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listClients(dept) {
  return Object.values(read(dept).clients || {});
}

function upsertClient(dept, client) {
  fs.mkdirSync(DIR, { recursive: true });
  const db = read(dept);
  db.clients = db.clients || {};
  db.clients[client.customer_name] = { ...db.clients[client.customer_name], ...client, department: dept };
  fs.writeFileSync(file(dept), JSON.stringify(db, null, 2), 'utf8');
  return db.clients[client.customer_name];
}

function findClient(name) {
  for (const dept of DEPTS) {
    const c = read(dept).clients?.[name];
    if (c) return { dept, ...c };
  }
  return null;
}

module.exports = { read, listClients, upsertClient, findClient, DEPTS };
