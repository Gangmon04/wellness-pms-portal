'use strict';

/**
 * crmApi.js
 *
 * Single source of truth for all Zoho CRM / Healthcare PMS module and field API names.
 * Standardized following the WidgetRepo convention.
 *
 * If a module or field API name changes in your Zoho CRM / PMS setup,
 * update it in this single file or override it via environment variables.
 */

// ─── User Types for Zoho CRM Users API ───────────────────────────────────────

const USER_TYPES = {
	ALL: 'AllUsers',
	ACTIVE: 'ActiveUsers',
	DEACTIVE: 'DeactiveUsers',
	CONFIRMED: 'ConfirmedUsers',
	NOT_CONFIRMED: 'NotConfirmedUsers',
	DELETED: 'DeletedUsers',
	ADMIN: 'AdminUsers'
};

// ─── Module API Names ────────────────────────────────────────────────────────

const MODULES = {
	APPOINTMENTS: process.env.PMS_MODULE_APPOINTMENTS || 'Appointments__s',
	SERVICES: process.env.PMS_MODULE_SERVICES || 'Services__s',
	PATIENT: process.env.PMS_MODULE_PATIENT || 'Patient',
	CONTACTS: process.env.PMS_MODULE_CONTACTS || 'Contacts',
	APP_SETTINGS: process.env.PMS_MODULE_APP_SETTINGS || 'App_Settings',
	USERS: 'users',
	ORG: 'org',
	BUSINESS_HOURS: 'settings/business_hours'
};

// ─── Appointments__s Module Field API Names ──────────────────────────────────

const APPOINTMENT_FIELDS = {
	ID: 'id',
	APPOINTMENT_ID: process.env.PMS_FIELD_APPOINTMENT_ID || 'Appointment_ID',
	NAME: 'Appointment_Name',
	START_TIME: 'Appointment_Start_Time',
	END_TIME: 'Appointment_End_Time',
	APPOINTMENT_FOR: 'Appointment_For',
	SERVICE_NAME: 'Service_Name',
	PRACTITIONER: 'Practitioner',
	DOCTOR: 'Doctor',
	PRIORITY: 'Priority',
	STATUS: 'Status',
	DESCRIPTION: 'Description',
	OWNER: 'Owner',
	LOCATION: 'Location'
};

// ─── Services__s Module Field API Names ──────────────────────────────────────

const SERVICE_FIELDS = {
	ID: 'id',
	NAME: 'Name',
	SERVICE_NAME: 'Service_Name',
	DURATION: 'Duration',
	DESCRIPTION: 'Description',
	PRICE: 'Price',
	STATUS: 'Status',
	LOCATION: 'Location',
	MEMBERS: 'Members'
};

// ─── Patient Module Field API Names ──────────────────────────────────────────

const PATIENT_FIELDS = {
	ID: 'id',
	NAME: 'Name',
	FIRST_NAME: 'First_Name',
	LAST_NAME: 'Last_Name',
	FULL_NAME: 'Full_Name',
	MOBILE: 'Mobile_No',
	EMAIL: 'Email',
	DATE_OF_BIRTH: 'Date_of_Birth',
	GENDER: 'Gender',
	BLOOD_GROUP: 'Blood_Group',
	ADDRESS: 'Address',
	AGE: 'Age'
};

// ─── Contacts Module Field API Names ─────────────────────────────────────────

const CONTACT_FIELDS = {
	ID: 'id',
	FIRST_NAME: 'First_Name',
	LAST_NAME: 'Last_Name',
	FULL_NAME: 'Full_Name',
	MOBILE: 'Mobile',
	PHONE: 'Phone',
	EMAIL: 'Email',
	LEAD_SOURCE: 'Lead_Source'
};

// ─── App_Settings Module Field API Names ─────────────────────────────────────

const APP_SETTINGS_FIELDS = {
	ID: 'id',
	HOSPITAL_NAME: 'Hospital_Name',
	CONTACT_NUMBER: 'Contact_Number',
	EMAIL_ID: 'Email_ID',
	PRACTICE_TYPE: 'Practice_Type',
	ADDRESS: 'Address',
	CITY: 'City',
	STATE: 'State',
	PINCODE: 'Pincode'
};

module.exports = {
	USER_TYPES,
	MODULES,
	APPOINTMENT_FIELDS,
	SERVICE_FIELDS,
	PATIENT_FIELDS,
	CONTACT_FIELDS,
	APP_SETTINGS_FIELDS
};
