const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp({ storageBucket: 'demo-sfayw.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const superadminPasswordHash = defineSecret('SUPERADMIN_PASSWORD_HASH');
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const superadmin = require('./src/functions/superadmin');
const tripAuth = require('./src/functions/tripAuth');
const tripSetup = require('./src/functions/tripSetup');
const members = require('./src/functions/members');
const expenses = require('./src/functions/expenses');
const receipts = require('./src/functions/receipts');
const report = require('./src/functions/report');

function wrap(handler) {
  return async (request) => {
    try {
      return await handler(db, request.data);
    } catch (err) {
      throw new HttpsError('invalid-argument', err.message);
    }
  };
}

exports.verifySuperadminPassword = onCall({ secrets: [superadminPasswordHash] }, async (request) => {
  try {
    return await superadmin.verifySuperadminPassword(db, superadminPasswordHash.value(), request.data);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
});

exports.createTrip = onCall(wrap(superadmin.createTrip));
exports.listTrips = onCall(wrap(superadmin.listTrips));
exports.updateTrip = onCall(wrap(superadmin.updateTrip));
exports.archiveTrip = onCall(wrap(superadmin.archiveTrip));

exports.verifyAdminPin = onCall(wrap(tripAuth.verifyAdminPin));
exports.verifyMemberPin = onCall(wrap(tripAuth.verifyMemberPin));
exports.listMembersForLogin = onCall(wrap(tripAuth.listMembersForLogin));

exports.getTripSetup = onCall(wrap(tripSetup.getTripSetup));
exports.updateTripSetup = onCall(wrap(tripSetup.updateTripSetup));

exports.addMember = onCall(wrap(members.addMember));
exports.updateMember = onCall(wrap(members.updateMember));

exports.listExpenses = onCall(wrap(expenses.listExpenses));
exports.addExpense = onCall(wrap(expenses.addExpense));
exports.updateExpense = onCall(wrap(expenses.updateExpense));
exports.confirmExpense = onCall(wrap(expenses.confirmExpense));

exports.classifyReceipt = onCall({ secrets: [geminiApiKey] }, async (request) => {
  try {
    return await receipts.classifyReceipt(db, bucket, geminiApiKey.value(), request.data);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
});

exports.getReportData = onCall(wrap(report.getReportData));
