export type FieldDefinition = {
  start: number;
  end: number;
  name: string;
  description: string;
};

export const recordTypeDescriptions: Record<string, string> = {
  '1': 'File Header Record - Contains information about the originator and the file',
  '5': 'Batch Header Record - Contains information about the company and batch',
  '6': 'Entry Detail Record - Contains individual transaction information',
  '7': 'Addenda Record - Additional information related to an entry detail',
  '8': 'Batch Control Record - Contains batch totals and counts',
  '9': 'File Control Record - Contains file totals and counts'
};

export const iatRecordFields: Record<string, FieldDefinition[]> = {
  '5': [
    { start: 0, end: 1, name: 'Record Type Code', description: '5 - Batch Header Record' },
    { start: 1, end: 4, name: 'Service Class Code', description: '200=Mixed, 220=Credits, 225=Debits' },
    { start: 4, end: 20, name: 'IAT Indicator', description: 'Blank for forward IAT entries; IATCOR for an IAT Notification of Change' },
    { start: 20, end: 22, name: 'Foreign Exchange Indicator', description: 'FV=Fixed-to-Variable, VF=Variable-to-Fixed, FF=Fixed-to-Fixed' },
    { start: 22, end: 23, name: 'Foreign Exchange Reference Indicator', description: '1=Exchange Rate, 2=Reference Number, 3=Space filled' },
    { start: 23, end: 38, name: 'Foreign Exchange Reference', description: 'Exchange rate or reference number' },
    { start: 38, end: 40, name: 'ISO Destination Country Code', description: '2-character ISO country code' },
    { start: 40, end: 50, name: 'Originator Identification', description: 'Company tax ID or other identifier' },
    { start: 50, end: 53, name: 'Standard Entry Class', description: 'Always IAT' },
    { start: 53, end: 63, name: 'Company Entry Description', description: 'Description of entries (e.g., PAYROLL)' },
    { start: 63, end: 66, name: 'ISO Originating Currency Code', description: '3-character ISO currency code' },
    { start: 66, end: 69, name: 'ISO Destination Currency Code', description: '3-character ISO currency code' },
    { start: 69, end: 75, name: 'Effective Entry Date', description: 'YYMMDD - Date transactions should post' },
    { start: 75, end: 78, name: 'Settlement Date (Julian)', description: 'Reserved/blank or Julian date' },
    { start: 78, end: 79, name: 'Originator Status Code', description: 'Always 1' },
    { start: 79, end: 87, name: 'Originating DFI Identification', description: 'First 8 digits of routing number' },
    { start: 87, end: 94, name: 'Batch Number', description: 'Sequential batch number within file' }
  ],
  '6': [
    { start: 0, end: 1, name: 'Record Type Code', description: '6 - Entry Detail Record' },
    { start: 1, end: 3, name: 'Transaction Code', description: '22=Chk Credit, 27=Chk Debit, 32=Sav Credit, 37=Sav Debit' },
    { start: 3, end: 11, name: 'Receiving DFI Identification', description: 'First 8 digits of receiving bank routing number' },
    { start: 11, end: 12, name: 'Check Digit', description: '9th digit of routing number (checksum)' },
    { start: 12, end: 16, name: 'Number of Addenda Records', description: '4-digit total of addenda records for this entry' },
    { start: 16, end: 29, name: 'Reserved', description: 'Blank/spaces' },
    { start: 29, end: 39, name: 'Amount', description: 'Transaction amount in cents' },
    { start: 39, end: 74, name: 'Foreign Receiver\'s Account Number', description: 'Receiver account number' },
    { start: 74, end: 75, name: 'Gateway Operator OFAC Screening Indicator', description: 'Gateway screening status' },
    { start: 75, end: 76, name: 'Secondary OFAC Screening Indicator', description: 'Secondary screening status' },
    { start: 76, end: 78, name: 'Reserved', description: 'Blank/spaces' },
    { start: 78, end: 79, name: 'Addenda Record Indicator', description: 'Always 1 for IAT' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Unique transaction identifier' }
  ]
};

// Public layout reference: Nacha Operating Rules Basic Appendices,
// Appendix Three, ACH File Record Format for ADV Entries.
export const advRecordFields: Record<string, FieldDefinition[]> = {
  '6': [
    { start: 0, end: 1, name: 'Record Type Code', description: '6 - ADV Entry Detail Record' },
    { start: 1, end: 3, name: 'Transaction Code', description: '81-88 Automated Accounting Advice debit or credit classification' },
    { start: 3, end: 11, name: 'Receiving DFI Identification', description: 'First 8 digits of the receiving DFI routing number' },
    { start: 11, end: 12, name: 'Check Digit', description: '9th digit of the receiving DFI routing number' },
    { start: 12, end: 27, name: 'DFI Account Number', description: '15-character account number receiving the advice' },
    { start: 27, end: 39, name: 'Amount', description: '12-digit summary debit or credit amount in cents' },
    { start: 39, end: 48, name: 'Advice Routing Number', description: '9-digit routing number of the DFI, Respondent, or Correspondent' },
    { start: 48, end: 53, name: 'File Identification', description: 'Optional File Creation Date and File ID Modifier reference' },
    { start: 53, end: 54, name: 'ACH Operator Data', description: 'Optional ACH Operator data' },
    { start: 54, end: 76, name: 'Individual Name', description: 'Name associated with the accounting advice' },
    { start: 76, end: 78, name: 'Discretionary Data', description: 'Optional data for specialized handling' },
    { start: 78, end: 79, name: 'Addenda Record Indicator', description: '0=No addenda, 1=Addenda follows' },
    { start: 79, end: 87, name: 'Routing Number of ACH Operator', description: '8-digit routing number of the transmitting ACH Operator' },
    { start: 87, end: 90, name: 'Advice Creation Julian Date', description: '001-366 Julian date on which the advice was created' },
    { start: 90, end: 94, name: 'Sequence Number Within Batch', description: 'Four-digit sequence beginning with 0001 in each ADV batch' },
  ],
  '8': [
    { start: 0, end: 1, name: 'Record Type Code', description: '8 - ADV Batch Control Record' },
    { start: 1, end: 4, name: 'Service Class Code', description: '280 - Automated Accounting Advices' },
    { start: 4, end: 10, name: 'Entry/Addenda Count', description: 'Total entry and addenda records in the ADV batch' },
    { start: 10, end: 20, name: 'Entry Hash', description: 'Low-order 10 digits of the Receiving DFI Identification sum' },
    { start: 20, end: 40, name: 'Total Debit Entry Dollar Amount', description: '20-digit accumulated ADV debit amount in cents' },
    { start: 40, end: 60, name: 'Total Credit Entry Dollar Amount', description: '20-digit accumulated ADV credit amount in cents' },
    { start: 60, end: 79, name: 'ACH Operator Data', description: 'Optional ACH Operator data' },
    { start: 79, end: 87, name: 'Originating DFI Identification', description: 'Originating DFI Identification from the Batch Header' },
    { start: 87, end: 94, name: 'Batch Number', description: 'Batch number from the Batch Header' },
  ],
  '9': [
    { start: 0, end: 1, name: 'Record Type Code', description: '9 - ADV File Control Record' },
    { start: 1, end: 7, name: 'Batch Count', description: 'Number of ADV batches in the file' },
    { start: 7, end: 13, name: 'Block Count', description: 'Number of 10-record blocks in the file' },
    { start: 13, end: 21, name: 'Entry/Addenda Count', description: 'Total ADV entry and addenda records in the file' },
    { start: 21, end: 31, name: 'Entry Hash', description: 'Low-order 10 digits of the batch Entry Hash sum' },
    { start: 31, end: 51, name: 'Total Debit Entry Dollar Amount', description: '20-digit accumulated ADV debit amount in cents' },
    { start: 51, end: 71, name: 'Total Credit Entry Dollar Amount', description: '20-digit accumulated ADV credit amount in cents' },
    { start: 71, end: 94, name: 'Reserved', description: 'Blank/spaces' },
  ],
};

// Public layout reference: Nacha Operating Rules Basic Appendices,
// Appendix Three, IAT Addenda Records (types 10-18).
export const addendaIATFields: Record<string, FieldDefinition[]> = {
  '10': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '10 - First mandatory IAT Addenda' },
    { start: 3, end: 6, name: 'Transaction Type Code', description: 'Reason for payment or permitted secondary SEC code' },
    { start: 6, end: 24, name: 'Foreign Payment Amount', description: '18-digit foreign payment amount' },
    { start: 24, end: 46, name: 'Foreign Trace Number', description: 'Optional trace assigned in the foreign payment system' },
    { start: 46, end: 81, name: 'Receiving Company Name / Individual Name', description: 'Name identifying the Receiver' },
    { start: 81, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '11': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '11 - Originator Name and Address' },
    { start: 3, end: 38, name: 'Originator Name', description: 'Full name of the originator' },
    { start: 38, end: 73, name: 'Originator Street Address', description: 'Originator\'s street address' },
    { start: 73, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '12': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '12 - Originator Address Addenda' },
    { start: 3, end: 38, name: 'Originator City and State / Province', description: 'Delimited originator city and state/province' },
    { start: 38, end: 73, name: 'Originator Country and Postal Code', description: 'Delimited ISO country and postal code' },
    { start: 73, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '13': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '13 - Originating DFI Addenda' },
    { start: 3, end: 38, name: 'Originating DFI Name', description: 'Name of the originating financial institution' },
    { start: 38, end: 40, name: 'Originating DFI Identification Number Qualifier', description: '01=National Clearing, 02=SWIFT BIC, 03=IBAN' },
    { start: 40, end: 74, name: 'Originating DFI Identification', description: 'Identifier formatted according to the qualifier' },
    { start: 74, end: 77, name: 'Originating DFI Branch Country Code', description: '2-character ISO country code followed by a space' },
    { start: 77, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '14': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '14 - Receiving DFI Addenda' },
    { start: 3, end: 38, name: 'Receiving DFI Name', description: 'Name of the receiving financial institution' },
    { start: 38, end: 40, name: 'Receiving DFI Identification Number Qualifier', description: '01=National Clearing, 02=SWIFT BIC, 03=IBAN' },
    { start: 40, end: 74, name: 'Receiving DFI Identification', description: 'Identifier formatted according to the qualifier' },
    { start: 74, end: 77, name: 'Receiving DFI Branch Country Code', description: '2-character ISO country code followed by a space' },
    { start: 77, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '15': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '15 - Receiver Addenda' },
    { start: 3, end: 18, name: 'Receiver Identification Number', description: 'Optional receiver identifier' },
    { start: 18, end: 53, name: 'Receiver Street Address', description: 'Receiver\'s street address' },
    { start: 53, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '16': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '16 - Receiver Address Addenda' },
    { start: 3, end: 38, name: 'Receiver City and State / Province', description: 'Delimited receiver city and state/province' },
    { start: 38, end: 73, name: 'Receiver Country and Postal Code', description: 'Delimited ISO country and postal code' },
    { start: 73, end: 87, name: 'Reserved', description: 'Blank/spaces' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '17': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '17 - IAT Remittance Information' },
    { start: 3, end: 83, name: 'Payment Related Information', description: 'Optional remittance or secondary-SEC information' },
    { start: 83, end: 87, name: 'Addenda Sequence Number', description: 'Sequence of type 17 records beginning with 0001' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
  '18': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '18 - Foreign Correspondent Bank Information' },
    { start: 3, end: 38, name: 'Foreign Correspondent Bank Name', description: 'Name of the foreign correspondent bank' },
    { start: 38, end: 40, name: 'Foreign Correspondent Bank Identification Number Qualifier', description: '01=National Clearing, 02=SWIFT BIC, 03=IBAN' },
    { start: 40, end: 74, name: 'Foreign Correspondent Bank Identification', description: 'Identifier formatted according to the qualifier' },
    { start: 74, end: 77, name: 'Foreign Correspondent Bank Branch Country Code', description: '2-character ISO country code followed by a space' },
    { start: 77, end: 83, name: 'Reserved', description: 'Blank/spaces' },
    { start: 83, end: 87, name: 'Addenda Sequence Number', description: 'Sequence of type 18 records beginning with 0001' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Last 7 digits of the related Entry Detail trace number' },
  ],
};

// Public layout reference: 2025 Nacha Operating Rules, Basic Edition,
// Appendices Four (Returns) and Five (Notifications of Change).
export const returnAndNocAddendaFields: Record<string, FieldDefinition[]> = {
  '98': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '98 - Notification of Change Addenda' },
    { start: 3, end: 6, name: 'Change Code', description: 'Cxx code identifying the information to correct' },
    { start: 6, end: 21, name: 'Original Entry Trace Number', description: 'Trace number from the original forward entry' },
    { start: 21, end: 27, name: 'Reserved', description: 'Blank/spaces' },
    { start: 27, end: 35, name: 'Original Receiving DFI Identification', description: 'Receiving DFI identification from the original entry' },
    { start: 35, end: 64, name: 'Corrected Data', description: 'Corrected information formatted according to the Change Code' },
    { start: 64, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Trace number of this Notification of Change entry' },
  ],
  '99': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '99 - Return Addenda' },
    { start: 3, end: 6, name: 'Return Reason Code', description: 'Rxx code identifying the reason for the return' },
    { start: 6, end: 21, name: 'Original Entry Trace Number', description: 'Trace number from the original forward entry' },
    { start: 21, end: 27, name: 'Date of Death', description: 'YYMMDD for return reason R14 or R15; otherwise blank' },
    { start: 27, end: 35, name: 'Original Receiving DFI Identification', description: 'Receiving DFI identification from the original entry' },
    { start: 35, end: 79, name: 'Addenda Information', description: 'Optional explanatory return information' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Trace number of this Return entry' },
  ],
};

export const iatReturnAndNocAddendaFields: Record<string, FieldDefinition[]> = {
  '98': returnAndNocAddendaFields['98'].map(field =>
    field.name === 'Corrected Data'
      ? { ...field, end: 70, description: 'Corrected IAT information formatted according to the Change Code' }
      : field.name === 'Reserved' && field.start === 64
        ? { ...field, start: 70 }
        : field,
  ),
  '99': [
    ...returnAndNocAddendaFields['99'].slice(0, 6),
    { start: 35, end: 45, name: 'Original Forward Entry Payment Amount', description: 'Original IAT forward-entry payment amount in cents' },
    { start: 45, end: 79, name: 'Addenda Information', description: 'Optional explanatory return information' },
    returnAndNocAddendaFields['99'][7],
  ],
};

const terminalAddendaCommonFields: FieldDefinition[] = [
  { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
  { start: 1, end: 3, name: 'Addenda Type Code', description: '02 - Terminal information addenda' },
  { start: 3, end: 10, name: 'Reference Information #1', description: 'Optional card-processor reference information' },
  { start: 10, end: 13, name: 'Reference Information #2', description: 'Optional card-processor reference information' },
  { start: 13, end: 19, name: 'Terminal Identification Code', description: 'Identifier of the terminal where the transaction occurred' },
  { start: 19, end: 25, name: 'Transaction Serial Number', description: 'Terminal-assigned transaction serial number' },
  { start: 25, end: 29, name: 'Transaction Date', description: 'MMDD date on which the terminal transaction occurred' },
  { start: 29, end: 35, name: 'Authorization Code or Card Expiration Date', description: 'Optional authorization code or card-expiration reference' },
  { start: 35, end: 62, name: 'Terminal Location', description: 'Name or location of the terminal owner' },
  { start: 62, end: 77, name: 'Terminal City', description: 'City where the terminal is located' },
  { start: 77, end: 79, name: 'Terminal State', description: 'State or location code for the terminal' },
  { start: 79, end: 94, name: 'Trace Number', description: 'Complete Trace Number of the related Entry Detail Record' },
];

const terminalAddendaFieldsBySec: Record<string, FieldDefinition[]> = {
  MTE: [
    terminalAddendaCommonFields[0],
    terminalAddendaCommonFields[1],
    { start: 3, end: 10, name: 'Transaction Description', description: 'Description assigned to the machine transfer transaction' },
    { start: 10, end: 13, name: 'Network Identification Code', description: 'Optional identifier of the transaction network' },
    ...terminalAddendaCommonFields.slice(4, 7),
    { start: 29, end: 35, name: 'Transaction Time', description: 'HHMMSS time at which the terminal transaction occurred' },
    ...terminalAddendaCommonFields.slice(8),
  ],
  POS: terminalAddendaCommonFields,
  SHR: terminalAddendaCommonFields,
};

export const recordFields: Record<string, FieldDefinition[]> = {
  '1': [
    { start: 0, end: 1, name: 'Record Type Code', description: '1 - File Header Record' },
    { start: 1, end: 3, name: 'Priority Code', description: 'Always 01' },
    { start: 3, end: 13, name: 'Immediate Destination', description: 'Routing number of receiving bank' },
    { start: 13, end: 23, name: 'Immediate Origin', description: 'Routing number or tax ID of originator' },
    { start: 23, end: 29, name: 'File Creation Date', description: 'YYMMDD format' },
    { start: 29, end: 33, name: 'File Creation Time', description: 'HHMM format (optional)' },
    { start: 33, end: 34, name: 'File ID Modifier', description: 'A-Z or 0-9, increments for multiple files per day' },
    { start: 34, end: 37, name: 'Record Size', description: 'Always 094' },
    { start: 37, end: 39, name: 'Blocking Factor', description: 'Always 10' },
    { start: 39, end: 40, name: 'Format Code', description: 'Always 1' },
    { start: 40, end: 63, name: 'Immediate Destination Name', description: 'Name of receiving bank' },
    { start: 63, end: 86, name: 'Immediate Origin Name', description: 'Name of originating company' },
    { start: 86, end: 94, name: 'Reference Code', description: 'Optional reference code' }
  ],
  '5': [
    { start: 0, end: 1, name: 'Record Type Code', description: '5 - Batch Header Record' },
    { start: 1, end: 4, name: 'Service Class Code', description: '200=Mixed, 220=Credits, 225=Debits, 280=Automated' },
    { start: 4, end: 20, name: 'Company Name', description: 'Name of the company originating the batch' },
    { start: 20, end: 40, name: 'Company Discretionary Data', description: 'Optional data for company use' },
    { start: 40, end: 50, name: 'Company Identification', description: 'Tax ID or routing number' },
    { start: 50, end: 53, name: 'Standard Entry Class', description: 'PPD, CCD, WEB, TEL, etc.' },
    { start: 53, end: 63, name: 'Company Entry Description', description: 'Description of entries (e.g., PAYROLL)' },
    { start: 63, end: 69, name: 'Company Descriptive Date', description: 'Optional date in any format' },
    { start: 69, end: 75, name: 'Effective Entry Date', description: 'YYMMDD - Date transactions should post' },
    { start: 75, end: 78, name: 'Settlement Date (Julian)', description: 'Reserved/blank or Julian date' },
    { start: 78, end: 79, name: 'Originator Status Code', description: 'Always 1' },
    { start: 79, end: 87, name: 'Originating DFI Identification', description: 'First 8 digits of routing number' },
    { start: 87, end: 94, name: 'Batch Number', description: 'Sequential batch number within file' }
  ],
  '6': [
    { start: 0, end: 1, name: 'Record Type Code', description: '6 - Entry Detail Record' },
    { start: 1, end: 3, name: 'Transaction Code', description: '22=Chk Credit, 27=Chk Debit, 32=Sav Credit, 37=Sav Debit' },
    { start: 3, end: 11, name: 'Receiving DFI Identification', description: 'First 8 digits of receiving bank routing number' },
    { start: 11, end: 12, name: 'Check Digit', description: '9th digit of routing number (checksum)' },
    { start: 12, end: 29, name: 'DFI Account Number', description: 'Receiver account number (left-justified)' },
    { start: 29, end: 39, name: 'Amount', description: 'Transaction amount in cents (10 digits, zero-filled)' },
    { start: 39, end: 54, name: 'Individual Identification Number', description: 'Optional identification number' },
    { start: 54, end: 76, name: 'Individual Name', description: 'Name of account holder' },
    { start: 76, end: 78, name: 'Discretionary Data', description: 'Optional data for originator use' },
    { start: 78, end: 79, name: 'Addenda Record Indicator', description: '0=No addenda, 1=Addenda follows' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Unique transaction identifier (ODFI + sequence)' }
  ],
  '7': [
    { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '02=Standard, 05=ACH, etc.' },
    { start: 3, end: 83, name: 'Payment Related Information', description: 'Additional transaction details or payment information' },
    { start: 83, end: 87, name: 'Addenda Sequence Number', description: 'Sequential number for multiple addenda' },
    { start: 87, end: 94, name: 'Entry Detail Sequence Number', description: 'Links to entry detail record' }
  ],
  '8': [
    { start: 0, end: 1, name: 'Record Type Code', description: '8 - Batch Control Record' },
    { start: 1, end: 4, name: 'Service Class Code', description: 'Must match batch header (200, 220, 225, 280)' },
    { start: 4, end: 10, name: 'Entry/Addenda Count', description: 'Total number of entry and addenda records in batch' },
    { start: 10, end: 20, name: 'Entry Hash', description: 'Sum of first 8 digits of all routing numbers in batch' },
    { start: 20, end: 32, name: 'Total Debit Entry Dollar Amount', description: 'Sum of all debit amounts in batch (in cents)' },
    { start: 32, end: 44, name: 'Total Credit Entry Dollar Amount', description: 'Sum of all credit amounts in batch (in cents)' },
    { start: 44, end: 54, name: 'Company Identification', description: 'Must match batch header' },
    { start: 54, end: 73, name: 'Message Authentication Code', description: 'Optional security code' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 87, name: 'Originating DFI Identification', description: 'Must match batch header' },
    { start: 87, end: 94, name: 'Batch Number', description: 'Must match batch header' }
  ],
  '9': [
    { start: 0, end: 1, name: 'Record Type Code', description: '9 - File Control Record' },
    { start: 1, end: 7, name: 'Batch Count', description: 'Total number of batch headers (type 5) in file' },
    { start: 7, end: 13, name: 'Block Count', description: 'Total number of physical blocks in file' },
    { start: 13, end: 21, name: 'Entry/Addenda Count', description: 'Total number of entry and addenda records in file' },
    { start: 21, end: 31, name: 'Entry Hash', description: 'Sum of all entry hashes from batch controls' },
    { start: 31, end: 43, name: 'Total Debit Entry Dollar Amount', description: 'Sum of all debits in file (in cents)' },
    { start: 43, end: 55, name: 'Total Credit Entry Dollar Amount', description: 'Sum of all credits in file (in cents)' },
    { start: 55, end: 94, name: 'Reserved', description: 'Blank/spaces' }
  ]
};

function entryFieldsWith(overrides: Record<number, Pick<FieldDefinition, 'name' | 'description'>>): FieldDefinition[] {
  return recordFields['6'].map(field => overrides[field.start] ? { ...field, ...overrides[field.start] } : field);
}

const ctxEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 7).map(field => field.start === 39
    ? { ...field, name: 'Identification Number', description: 'Optional number used by the Originator to identify the entry' }
    : field),
  { start: 54, end: 58, name: 'Number of Addenda Records', description: 'Four-digit count of addenda records attached to this CTX entry' },
  { start: 58, end: 74, name: 'Receiving Company Name / ID Number', description: 'Name or identifying number of the corporate Receiver' },
  { start: 74, end: 76, name: 'Reserved', description: 'Blank/spaces' },
  { start: 76, end: 78, name: 'Discretionary Data', description: 'Optional data for originator use' },
  ...recordFields['6'].slice(9),
];

// Public layout reference: Nacha Operating Rules Basic Appendices,
// Appendix Six, Acknowledgment Entries.
const ackEntryFields = entryFieldsWith({
  39: { name: 'Original Entry Trace Number', description: 'Trace number from the original CCD entry being acknowledged' },
  54: { name: 'Receiving Company Name', description: 'Company name copied from the original CCD entry' },
});

const atxEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 7).map(field => field.start === 39
    ? { ...field, name: 'Original Entry Trace Number', description: 'Trace number from the original CTX entry being acknowledged' }
    : field),
  { start: 54, end: 58, name: 'Number of Addenda Records', description: 'Four-digit count of addenda records attached to this ATX acknowledgment' },
  { start: 58, end: 74, name: 'Receiving Company Name / ID Number', description: 'Company name or identifier copied from the original CTX entry' },
  { start: 74, end: 76, name: 'Reserved', description: 'Blank/spaces' },
  { start: 76, end: 78, name: 'Discretionary Data', description: 'Optional data for specialized handling' },
  ...recordFields['6'].slice(9),
];

// Public layout reference: Nacha Operating Rules Basic Appendices,
// Appendix Three, CIE, DNE, and ENR Entry Detail Records.
const cieEntryFields = entryFieldsWith({
  39: { name: 'Individual Name', description: 'Name of the consumer Originator initiating the bill payment' },
  54: { name: 'Individual Identification Number', description: 'Accounting reference by which the Originator is known to the Receiver' },
});

const dneEntryFields = entryFieldsWith({
  39: { name: 'Individual Identification Number', description: 'Optional identifier for the deceased benefit recipient' },
  54: { name: 'Individual Name', description: 'Name of the deceased benefit recipient' },
});

const enrEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 7).map(field => field.start === 39
    ? { ...field, name: 'Identification Number', description: 'Optional Originator identification; space-filled for Federal Government enrollment entries' }
    : field),
  { start: 54, end: 58, name: 'Number of Addenda Records', description: 'Four-digit count of addenda records attached to this enrollment entry' },
  { start: 58, end: 74, name: 'Receiving Company Name / ID Number', description: 'Name or identifier of the agency receiving the enrollment' },
  { start: 74, end: 76, name: 'Reserved', description: 'Blank/spaces' },
  { start: 76, end: 78, name: 'Discretionary Data', description: 'Optional data for specialized handling' },
  ...recordFields['6'].slice(9),
];

const mteEntryFields = entryFieldsWith({
  39: { name: 'Individual Name', description: 'Name of the consumer using the machine terminal' },
  54: { name: 'Individual Identification Number', description: 'Consumer identifier associated with the machine transfer' },
});

const posEntryFields = entryFieldsWith({
  39: { name: 'Individual Identification Number', description: 'Optional consumer identifier for the point-of-sale transaction' },
  54: { name: 'Individual Name', description: 'Name of the consumer making the point-of-sale transaction' },
  76: { name: 'Card Transaction Type Code', description: 'Card-network code identifying purchase, cash, reversal, return, adjustment, or miscellaneous activity' },
});

// Public layout reference: 2025 Nacha Operating Rules, Basic Edition,
// Appendix Three, POP Entry Detail Record.
const popEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 6),
  { start: 39, end: 48, name: 'Check Serial Number', description: 'Check serial number from the source document converted at the point of purchase' },
  { start: 48, end: 52, name: 'Terminal City', description: 'Four-character city abbreviation for the point-of-purchase terminal' },
  { start: 52, end: 54, name: 'Terminal State', description: 'Two-character state abbreviation for the point-of-purchase terminal' },
  { start: 54, end: 76, name: 'Individual Name / Receiving Company Name', description: 'Optional Receiver name' },
  ...recordFields['6'].slice(8),
];

const shrEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 6),
  { start: 39, end: 43, name: 'Card Expiration Date', description: 'MMYY expiration date of the card used for the transaction' },
  { start: 43, end: 54, name: 'Document Reference Number', description: '11-digit document reference assigned to the transaction' },
  { start: 54, end: 76, name: 'Individual Card Account Number', description: '22-digit card account number associated with the shared-network transaction' },
  { start: 76, end: 78, name: 'Card Transaction Type Code', description: 'Card-network code identifying purchase, cash, reversal, return, adjustment, or miscellaneous activity' },
  ...recordFields['6'].slice(9),
];

const trxEntryFields: FieldDefinition[] = [
  ...recordFields['6'].slice(0, 7).map(field => field.start === 39
    ? { ...field, name: 'Identification Number', description: 'Optional Originator-assigned number for tracing the check-safekeeping entry' }
    : field),
  { start: 54, end: 58, name: 'Number of Addenda Records', description: 'Four-digit count of addenda records attached to this TRX entry' },
  { start: 58, end: 74, name: 'Receiving Company Name / ID Number', description: 'Name or identifier of the check-safekeeping Receiver' },
  { start: 74, end: 76, name: 'Reserved', description: 'Blank/spaces' },
  { start: 76, end: 78, name: 'Item Type Indicator', description: 'Optional indicator identifying the type of truncated check item' },
  ...recordFields['6'].slice(9),
];

// These SEC classes share the standard 94-character Entry Detail shape but
// assign different business meaning to positions 40-78.
const entryFieldsBySec: Record<string, FieldDefinition[]> = {
  ACK: ackEntryFields,
  ARC: entryFieldsWith({
    39: { name: 'Check Serial Number', description: 'Check serial number from the converted source document' },
    54: { name: 'Individual Name / Receiving Company Name', description: 'Optional Receiver name' },
  }),
  ATX: atxEntryFields,
  BOC: entryFieldsWith({
    39: { name: 'Check Serial Number', description: 'Check serial number from the converted source document' },
    54: { name: 'Individual Name / Receiving Company Name', description: 'Optional Receiver name' },
  }),
  RCK: entryFieldsWith({
    39: { name: 'Check Serial Number', description: 'Check serial number from the represented check' },
    54: { name: 'Individual Name', description: 'Name of the Receiver on the represented check' },
  }),
  CCD: entryFieldsWith({
    39: { name: 'Identification Number', description: 'Optional number used by the Originator to identify the entry' },
    54: { name: 'Receiving Company Name', description: 'Name of the corporate Receiver' },
  }),
  CIE: cieEntryFields,
  CTX: ctxEntryFields,
  DNE: dneEntryFields,
  ENR: enrEntryFields,
  MTE: mteEntryFields,
  POP: popEntryFields,
  POS: posEntryFields,
  SHR: shrEntryFields,
  TRX: trxEntryFields,
  WEB: entryFieldsWith({
    39: { name: 'Individual Identification Number / P2P Originator Name', description: 'Optional for WEB debits; contains the consumer Originator name for a WEB credit' },
    76: { name: 'Payment Type Code', description: 'Optional Originator-defined code; R, S, and ST have conventional meanings' },
  }),
  TEL: entryFieldsWith({
    76: { name: 'Payment Type Code', description: 'Optional Originator-defined code; R, S, and ST have conventional meanings' },
  }),
};

export function getFieldsForRecord(recordType: string, line?: string, secCode?: string): FieldDefinition[] | undefined {
  let fields: FieldDefinition[] | undefined;

  if (recordType === '7' && line && line.length >= 3) {
    const addendaType = line.substring(1, 3);
    fields = secCode === 'IAT'
      ? iatReturnAndNocAddendaFields[addendaType]
      : returnAndNocAddendaFields[addendaType];
  }

  if (!fields && secCode === 'IAT') {
    if (recordType === '5' || recordType === '6') {
      fields = iatRecordFields[recordType];
    } else if (recordType === '7' && line && line.length >= 3) {
      const addendaType = line.substring(1, 3);
      fields = addendaIATFields[addendaType] || recordFields['7'];
    }
  }

  if (!fields && secCode === 'ADV') {
    fields = advRecordFields[recordType];
  }

  if (!fields && recordType === '7' && line && line.substring(1, 3) === '02' && secCode) {
    fields = terminalAddendaFieldsBySec[secCode];
  }

  if (!fields && recordType === '6' && secCode) {
    fields = entryFieldsBySec[secCode];
  }

  if (!fields) {
    fields = recordFields[recordType];
  }

  return fields;
}

export function getFieldAtPosition(recordType: string, position: number, line?: string, secCode?: string): FieldDefinition | undefined {
  const fields = getFieldsForRecord(recordType, line, secCode);

  if (!fields) {
    return undefined;
  }

  return fields.find(f => position >= f.start && position < f.end);
}
