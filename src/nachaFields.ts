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
    { start: 4, end: 12, name: 'IAT Indicator', description: 'Always "IAT      "' },
    { start: 12, end: 20, name: 'Reserved', description: 'Blank/spaces' },
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
    { start: 12, end: 15, name: 'Reserved', description: 'Blank/spaces' },
    { start: 15, end: 17, name: 'Number of Addenda Records', description: 'Total addenda records for this entry' },
    { start: 17, end: 29, name: 'Reserved', description: 'Blank/spaces' },
    { start: 29, end: 39, name: 'Amount', description: 'Transaction amount in cents' },
    { start: 39, end: 74, name: 'Foreign Receiver\'s Account Number', description: 'Receiver account number' },
    { start: 74, end: 76, name: 'Reserved', description: 'Blank/spaces' },
    { start: 76, end: 78, name: 'Gateway Operator Screening Indicator', description: 'OFAC status' },
    { start: 78, end: 79, name: 'Addenda Record Indicator', description: 'Always 1 for IAT' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Unique transaction identifier' }
  ]
};

export const addendaIATFields: Record<string, FieldDefinition[]> = {
  '10': [ // IAT Batch Header Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7 - Addenda Record' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '10 - IAT Batch Header Addenda' },
    { start: 3, end: 6, name: 'Transaction Type Code', description: 'ANN=Annuity, BUS=Business, DEP=Deposit, etc.' },
    { start: 6, end: 24, name: 'Foreign Payment Amount', description: 'Amount in foreign currency' },
    { start: 24, end: 26, name: 'Foreign Exchange Indicator', description: 'FV, VF, or FF' },
    { start: 26, end: 61, name: 'Receiver Name', description: 'Name of the receiver' },
    { start: 61, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '11': [ // Originator Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '11 - Originator Addenda' },
    { start: 3, end: 38, name: 'Originator Name', description: 'Full name of the originator' },
    { start: 38, end: 73, name: 'Originator Street Address', description: 'Originator\'s street address' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '12': [ // Originator Address Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '12 - Originator Address Addenda' },
    { start: 3, end: 38, name: 'Originator City', description: 'City name' },
    { start: 38, end: 73, name: 'Originator State/Country/Postal', description: 'State, Country Code, and Postal Code' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '13': [ // Originating DFI Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '13 - Originating DFI Addenda' },
    { start: 3, end: 38, name: 'ODFI Name', description: 'Name of originating bank' },
    { start: 38, end: 73, name: 'ODFI ID / Country Code', description: 'Bank ID and country code' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '14': [ // Receiving DFI Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '14 - Receiving DFI Addenda' },
    { start: 3, end: 38, name: 'RDFI Name', description: 'Name of receiving bank' },
    { start: 38, end: 73, name: 'RDFI ID / Country Code', description: 'Bank ID and country code' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '15': [ // Receiver Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '15 - Receiver Addenda' },
    { start: 3, end: 38, name: 'Receiver ID Number', description: 'Tax ID or individual ID' },
    { start: 38, end: 73, name: 'Receiver Street Address', description: 'Receiver\'s street address' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ],
  '16': [ // Receiver Address Addenda
    { start: 0, end: 1, name: 'Record Type Code', description: '7' },
    { start: 1, end: 3, name: 'Addenda Type Code', description: '16 - Receiver Address Addenda' },
    { start: 3, end: 38, name: 'Receiver City', description: 'City name' },
    { start: 38, end: 73, name: 'Receiver State/Country/Postal', description: 'State, Country Code, and Postal Code' },
    { start: 73, end: 79, name: 'Reserved', description: 'Blank/spaces' },
    { start: 79, end: 94, name: 'Trace Number', description: 'Links to entry detail record' }
  ]
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

export function getFieldsForRecord(recordType: string, line?: string, secCode?: string): FieldDefinition[] | undefined {
  let fields: FieldDefinition[] | undefined;

  if (secCode === 'IAT') {
    if (recordType === '5' || recordType === '6') {
      fields = iatRecordFields[recordType];
    } else if (recordType === '7' && line && line.length >= 3) {
      const addendaType = line.substring(1, 3);
      fields = addendaIATFields[addendaType] || recordFields['7'];
    }
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
