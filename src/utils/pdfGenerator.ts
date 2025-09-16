// PDF Generation utility using HTML to print/PDF conversion
// Since we don't have jsPDF installed, I'll create a simple HTML-to-print function
// In a real app, you'd want to use a proper PDF library like jsPDF or react-pdf

export interface DocumentData {
  type: 'quotation' | 'invoice' | 'remittance' | 'proforma' | 'delivery' | 'statement' | 'receipt' | 'lpo' | 'boq';
  number: string;
  date: string;
  lpo_number?: string;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
  };
  company?: CompanyDetails; // Optional company details override
  // BOQ-specific structured fields
  project_title?: string;
  contractor?: string;
  items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    discount_percentage?: number;
    discount_before_vat?: number;
    discount_amount?: number;
    tax_percentage?: number;
    tax_amount?: number;
    tax_inclusive?: boolean;
    line_total: number;
    unit_of_measure?: string;
    transaction_date?: string;
    reference?: string;
    debit?: number;
    credit?: number;
    transaction_type?: string;
    balance?: number;
    days_overdue?: number;
    due_date?: string;
  }>;
  subtotal?: number;
  tax_amount?: number;
  total_amount: number;
  paid_amount?: number;
  balance_due?: number;
  notes?: string;
  terms_and_conditions?: string;
  valid_until?: string; // For proforma invoices
  due_date?: string; // For invoices
  // Delivery note specific fields
  delivery_date?: string;
  delivery_address?: string;
  delivery_method?: string;
  carrier?: string;
  tracking_number?: string;
  delivered_by?: string;
  received_by?: string;
}

// Company details interface
interface CompanyDetails {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  logo_url?: string;
}

// Default company details (fallback) - logo will be determined dynamically
const DEFAULT_COMPANY: CompanyDetails = {
  name: 'Layons Construction Limited',
  address: '',
  city: 'Nairobi',
  country: 'Kenya',
  phone: '',
  email: 'layonscoltd@gmail.com',
  tax_number: '',
  logo_url: 'https://cdn.builder.io/api/v1/image/assets%2Fb048b36350454e4dba55aefd37788f9c%2Fbd04dab542504461a2451b061741034c?format=webp&width=800'
};

// Helper function to determine which columns have values
const analyzeColumns = (items: DocumentData['items']) => {
  if (!items || items.length === 0) return {};

  const columns = {
    discountPercentage: false,
    discountBeforeVat: false,
    discountAmount: false,
    taxPercentage: false,
    taxAmount: false,
  };

  items.forEach(item => {
    if (item.discount_percentage && item.discount_percentage > 0) {
      columns.discountPercentage = true;
    }
    if (item.discount_before_vat && item.discount_before_vat > 0) {
      columns.discountBeforeVat = true;
    }
    if (item.discount_amount && item.discount_amount > 0) {
      columns.discountAmount = true;
    }
    if (item.tax_percentage && item.tax_percentage > 0) {
      columns.taxPercentage = true;
    }
    if (item.tax_amount && item.tax_amount > 0) {
      columns.taxAmount = true;
    }
  });

  return columns;
};

export const generatePDF = (data: DocumentData) => {
  // Extract theme color variables from the main document so PDFs match the app theme
  const computed = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const primaryVar = computed ? (computed.getPropertyValue('--primary') || '46 65% 53%').trim() : '46 65% 53%';
  const primaryForegroundVar = computed ? (computed.getPropertyValue('--primary-foreground') || '0 0% 10%').trim() : '0 0% 10%';
  const successVar = computed ? (computed.getPropertyValue('--success') || '140 50% 45%').trim() : '140 50% 45%';
  const warningVar = computed ? (computed.getPropertyValue('--warning') || '45 85% 57%').trim() : '45 85% 57%';

  // Build CSS root variables to inject into the PDF window
  const pdfRootVars = `:root { --primary: ${primaryVar}; --primary-foreground: ${primaryForegroundVar}; --success: ${successVar}; --warning: ${warningVar}; }`;

  // Use company details from data or fall back to defaults
  const company = data.company || DEFAULT_COMPANY;

  // Analyze which columns have values
  const visibleColumns = analyzeColumns(data.items);
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  // Create a new window with the document content
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Could not open print window. Please allow popups.');
  }

  const documentTitle = data.type === 'proforma' ? 'Proforma Invoice' :
                       data.type === 'delivery' ? 'Delivery Note' :
                       data.type === 'statement' ? 'Customer Statement' :
                       data.type === 'receipt' ? 'Payment Receipt' :
                       data.type === 'remittance' ? 'Remittance Advice' :
                       data.type === 'lpo' ? 'Purchase Order' :
                       data.type === 'boq' ? 'Bill of Quantities' :
                       data.type.charAt(0).toUpperCase() + data.type.slice(1);
  
  // Prefer structured fields if present, otherwise fall back to parsing notes
  let boqProject = data.project_title || '';
  let boqContractor = data.contractor || '';
  if (data.type === 'boq' && (!boqProject || !boqContractor) && data.notes) {
    const parts = data.notes.split('\n');
    parts.forEach(p => {
      const t = p.trim();
      if (!boqProject && t.toUpperCase().startsWith('PROJECT:')) boqProject = t.replace(/PROJECT:\s*/i, '').trim();
      if (!boqContractor && t.toUpperCase().startsWith('CONTRACTOR:')) boqContractor = t.replace(/CONTRACTOR:\s*/i, '').trim();
    });
  }

  // If this is a BOQ, render a dedicated BOQ-style layout
  if (data.type === 'boq') {
    // Build table rows grouped by section markers (we used '➤ ' prefix for section rows)
    const rowsHtml = (data.items || []).map((it) => {
      const isSection = (it.quantity === 0 && it.unit_price === 0);
      if (isSection) {
        return `<tr class="section-row"><td colspan="5" class="section-title">${it.description.replace(/^➤\s*/, '')}</td></tr>`;
      }
      return `<tr class="item-row">
        <td class="desc">${it.description}</td>
        <td class="qty">${it.quantity || ''}</td>
        <td class="unit">${it.unit_abbreviation || it.unit_of_measure || ''}</td>
        <td class="rate">${formatCurrency(it.unit_price || 0)}</td>
        <td class="amount">${formatCurrency(it.line_total || 0)}</td>
      </tr>`;
    }).join('');

    const htmlContentBOQ = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BILLS OF QUANTITIES ${data.number}</title>
      <meta charset="UTF-8">
      <style>
        ${pdfRootVars}
        @page { size: A4; margin: 12mm; }
        @media print {
          @page { counter-increment: page; }
        }
        * { box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; margin:0; color:#222; font-size:12px; }
        body { counter-reset: page; }
        .pagefoot::after { content: "Page " counter(page) ""; }
        .container { padding: 12mm; }
        .top-headers { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .company { text-align:right; }
        .company .name { font-size:18px; font-weight:700; color:hsl(var(--primary)); }
        .subtitle { font-size:11px; color:#444; }
        .title { text-align:center; font-size:20px; font-weight:700; margin:12px 0; color:hsl(var(--primary)); }
        .meta { display:flex; justify-content:space-between; margin-bottom:12px; }
        .meta .left, .meta .right { width:48%; }
        .meta .left .field { margin-bottom:6px; }
        .items { width:100%; border-collapse:collapse; margin-top:8px; }
        .items th, .items td { border:1px solid #e6e6e6; padding:6px 8px; }
        .items thead th { background:hsl(var(--primary)); color:#fff; font-weight:700; }
        .section-row td.section-title { background:#f4f4f4; font-weight:700; padding:8px; }
        .item-row td.desc { width:60%; }
        .item-row td.qty, .item-row td.unit, .item-row td.rate, .item-row td.amount { text-align:right; }
        .totals { margin-top:12px; width:100%; }
        .totals .label { text-align:right; padding-right:12px; }
        .footer { margin-top:30px; display:flex; justify-content:space-between; gap:20px; }
        .sig { width:45%; border-top:1px solid #999; text-align:left; padding-top:6px; }
        .pagefoot { position:fixed; bottom:12mm; left:12mm; right:12mm; text-align:center; font-size:10px; color:#666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="company-info">
            <div class="logo">
              ${company.logo_url ?
                `<img src="${company.logo_url}" alt="${company.name} Logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                 <div style="display:none; width:100%; height:100%; background:#f8f9fa; border:2px dashed #e9ecef; display:flex; align-items:center; justify-content:center; font-size:12px; color:#6c757d; text-align:center;">Logo not available</div>` :
                `<div style="width:100%; height:100%; background:#f8f9fa; border:2px dashed #e9ecef; display:flex; align-items:center; justify-content:center; font-size:12px; color:#6c757d; text-align:center;">No logo configured</div>`
              }
            </div>
            <div class="company-name">${company.name}</div>
            <div class="company-details">
              ${company.tax_number ? `PIN: ${company.tax_number}<br>` : ''}
              ${company.address ? `${company.address}<br>` : ''}
              ${company.city ? `${company.city}` : ''}${company.country ? `, ${company.country}` : ''}<br>
              ${company.phone ? `Tel: ${company.phone}<br>` : ''}
              ${company.email ? `Email: ${company.email}` : ''}
            </div>

            <!-- Client Details Section -->
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e9ecef;">
              <div class="section-title" style="font-size: 12px; font-weight: bold; color: hsl(var(--primary)); margin-bottom: 8px; text-transform: uppercase;">Client</div>
              <div class="customer-name" style="font-size: 14px; font-weight: bold; margin-bottom: 5px; color: #212529;">${data.customer.name}</div>
              <div class="customer-details" style="font-size: 10px; color: #666; line-height: 1.4;">
                ${data.customer.email ? `${data.customer.email}<br>` : ''}
                ${data.customer.phone ? `${data.customer.phone}<br>` : ''}
                ${data.customer.address ? `${data.customer.address}<br>` : ''}
                ${data.customer.city ? `${data.customer.city}` : ''}
                ${data.customer.country ? `, ${data.customer.country}` : ''}
              </div>
            </div>
          </div>

          <div class="document-info">
            <div class="document-title">Bill of Quantities</div>
            <div class="document-details">
              <table>
                <tr>
                  <td class="label">BOQ #:</td>
                  <td class="value">${data.number}</td>
                </tr>
                <tr>
                  <td class="label">Date:</td>
                  <td class="value">${formatDate(data.date)}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <div class="title">BILLS OF QUANTITIES</div>

        <table class="items">
          <thead>
            <tr>
              <th style="width:60%; text-align:left">ITEM DESCRIPTION</th>
              <th style="width:8%">QTY</th>
              <th style="width:9%">UNIT</th>
              <th style="width:11%">RATE</th>
              <th style="width:12%">AMOUNT (KSHS)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="totals">
          <table style="width:100%; margin-top:8px;">
            <tr>
              <td class="label" style="text-align:right; font-weight:700;">TOTAL:</td>
              <td style="width:150px; text-align:right; font-weight:700;">${formatCurrency(data.total_amount || data.subtotal || 0)}</td>
            </tr>
          </table>
        </div>

        <div class="footer">
          <div class="sig">SIGNED: (CONTRACTOR)</div>
          <div class="sig">SIGNED: (EMPLOYER)</div>
        </div>
      </div>
      <div class="pagefoot">${company.name} • Generated on ${new Date().toLocaleDateString()}</div>
    </body>
    </html>
    `;

    printWindow.document.write(htmlContentBOQ);
    printWindow.document.close();

    printWindow.onload = () => setTimeout(() => printWindow.print(), 500);
    setTimeout(() => { if (printWindow && !printWindow.closed) printWindow.print(); }, 1000);

    return printWindow;
  }

  // Fallback generic document HTML (existing template)
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${documentTitle} ${data.number}</title>
      <meta charset="UTF-8">
      <style>
        ${pdfRootVars}
        @page {
          size: A4;
          margin: 15mm;
        }

        * {
          box-sizing: border-box;
        }

        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 0;
          color: #333;
          line-height: 1.4;
          font-size: 12px;
          background: white;
        }

        .page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: white;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          padding: 20mm;
          position: relative;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 2px solid hsl(var(--primary));
        }

        .company-info {
          flex: 1;
        }

        .logo {
          width: 320px;
          height: 160px;
          margin-bottom: 15px;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        
        .company-name {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 5px;
          color: hsl(var(--primary));
          font-weight: bold;
          margin-bottom: 5px;
          color: hsl(var(--primary));
        }
        
        .company-details {
          font-size: 11px;
          line-height: 1.6;
          color: #666;
          margin-bottom: 0;
        }
        
        .document-info {
          text-align: right;
          flex: 1;
          max-width: 300px;
        }
        
        .document-title {
          font-size: 28px;
          font-weight: bold;
          margin: 0 0 15px 0;
          color: hsl(var(--primary));
          text-transform: uppercase;
          font-weight: bold;
          margin: 0 0 15px 0;
          color: hsl(var(--primary));
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .document-details {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }
        
        .document-details table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .document-details td {
          padding: 5px 0;
          border: none;
        }
        
        .document-details .label {
          font-weight: bold;
          color: #495057;
          width: 40%;
        }
        
        .document-details .value {
          text-align: right;
          color: #212529;
        }
        
        
        .section-title {
          font-size: 14px;
          font-weight: bold;
          color: hsl(var(--primary));
          margin: 0 0 15px 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .customer-name {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 8px;
          color: #212529;
        }
        
        .customer-details {
          color: #666;
          line-height: 1.6;
        }
        
        .items-section {
          margin: 30px 0;
        }
        
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 11px;
          border: 2px solid hsl(var(--primary));
          border-radius: 8px;
          overflow: hidden;
        }
        
        .items-table thead {
          background: hsl(var(--primary));
          color: white;
        }
        
        .items-table th {
          padding: 12px 8px;
          text-align: center;
          font-weight: bold;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-right: 1px solid rgba(255,255,255,0.2);
        }
        
        .items-table th:last-child {
          border-right: none;
        }
        
        .items-table td {
          padding: 10px 8px;
          border-bottom: 1px solid #e9ecef;
          border-right: 1px solid #e9ecef;
          text-align: center;
          vertical-align: top;
        }
        
        .items-table td:last-child {
          border-right: none;
        }
        
        .items-table tbody tr:last-child td {
          border-bottom: none;
        }
        
        .items-table tbody tr:nth-child(even) {
          background: #f8f9fa;
        }
        
        .items-table tbody tr:hover {
          background: hsl(var(--primary-light));
        }
        
        .description-cell {
          text-align: left !important;
          max-width: 200px;
          word-wrap: break-word;
        }
        
        .amount-cell {
          text-align: right !important;
          font-weight: 500;
        }

        .center {
          text-align: center !important;
        }
        
        .totals-section {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
        }
        
        .totals-table {
          width: 300px;
          border-collapse: collapse;
          font-size: 12px;
        }
        
        .totals-table td {
          padding: 8px 15px;
          border: none;
        }
        
        .totals-table .label {
          text-align: left;
          color: #495057;
          font-weight: 500;
        }
        
        .totals-table .amount {
          text-align: right;
          font-weight: 600;
          color: #212529;
        }
        
        .totals-table .subtotal-row {
          border-top: 1px solid #dee2e6;
        }
        
        .totals-table .total-row {
          border-top: 2px solid hsl(var(--primary));
          background: #f8f9fa;
        }
        
        .totals-table .total-row .label {
          font-size: 14px;
          font-weight: bold;
          color: hsl(var(--primary));
        }
        
        .totals-table .total-row .amount {
          font-size: 16px;
          font-weight: bold;
          color: hsl(var(--primary));
        }
        
        
        .footer {
          position: absolute;
          bottom: 20mm;
          left: 20mm;
          right: 20mm;
          text-align: center;
          font-size: 10px;
          color: #666;
          border-top: 1px solid #e9ecef;
          padding-top: 15px;
        }
        
        .delivery-info-section {
          margin: 25px 0;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .delivery-details {
          margin-top: 15px;
        }

        .delivery-row {
          display: flex;
          gap: 20px;
          margin-bottom: 12px;
        }

        .delivery-field {
          flex: 1;
          min-width: 0;
        }

        .delivery-field.full-width {
          flex: 100%;
        }

        .field-label {
          font-size: 10px;
          font-weight: bold;
          color: hsl(var(--primary));
          margin-bottom: 4px;
          text-transform: uppercase;
        }

        .field-value {
          font-size: 11px;
          color: #333;
          line-height: 1.4;
          word-wrap: break-word;
        }

        .signature-section {
          margin: 30px 0 20px 0;
          padding: 20px;
          border-top: 1px solid #e9ecef;
        }

        .signature-row {
          display: flex;
          gap: 40px;
        }

        .signature-box {
          flex: 1;
          text-align: center;
        }

        .signature-label {
          font-size: 11px;
          font-weight: bold;
          color: hsl(var(--primary));
          margin-bottom: 20px;
          text-transform: uppercase;
        }

        .signature-line {
          font-size: 12px;
          font-weight: bold;
          color: #333;
          border-bottom: 1px solid #333;
          margin-bottom: 10px;
          padding-bottom: 5px;
          min-height: 20px;
        }

        .signature-date {
          font-size: 10px;
          color: #666;
        }

        .watermark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 72px;
          color: hsl(var(--primary) / 0.12);
          font-weight: bold;
          z-index: -1;
          pointer-events: none;
          text-transform: uppercase;
          letter-spacing: 5px;
        }
        
        @media print {
          body {
            background: white;
          }
          
          .page {
            box-shadow: none;
            margin: 0;
            padding: 0;
          }
          
          .watermark {
            display: ${data.type === 'proforma' ? 'block' : 'none'};
          }
        }
        
        @media screen {
          body {
            background: #f5f5f5;
            padding: 20px;
          }
        }
        \n        .payment-banner {\n          background: #f8f9fa;\n          padding: 8px 15px;\n          margin-bottom: 20px;\n          border-left: 4px solid hsl(var(--primary));\n          font-size: 10px;\n          color: #333;\n          text-align: center;\n          border-radius: 4px;\n          font-weight: 600;\n        }\n        \n        .bank-details {\n          background: #f8f9fa;\n          padding: 10px;\n          margin: 15px 0;\n          border-left: 4px solid hsl(var(--primary));\n          font-size: 10px;\n          color: #333;\n          text-align: center;\n          border-radius: 4px;\n          font-weight: 600;\n        }\n      </style>
    </head>
    <body>
      <div class="page">
        <!-- Watermark for proforma invoices -->
        ${data.type === 'proforma' ? '<div class="watermark">Proforma</div>' : ''}
        
        <!-- Header Section -->
        <div class="header">
          <div class="company-info">
            <div class="logo">
              ${company.logo_url ?
                `<img src="${company.logo_url}" alt="${company.name} Logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                 <div style="display:none; width:100%; height:100%; background:#f8f9fa; border:2px dashed #e9ecef; display:flex; align-items:center; justify-content:center; font-size:12px; color:#6c757d; text-align:center;">Logo not available</div>` :
                `<div style="width:100%; height:100%; background:#f8f9fa; border:2px dashed #e9ecef; display:flex; align-items:center; justify-content:center; font-size:12px; color:#6c757d; text-align:center;">No logo configured</div>`
              }
            </div>
            <div class="company-name">${company.name}</div>
            <div class="company-details">
              ${company.tax_number ? `PIN: ${company.tax_number}<br>` : ''}
              ${company.address ? `${company.address}<br>` : ''}
              ${company.city ? `${company.city}` : ''}${company.country ? `, ${company.country}` : ''}<br>
              ${company.phone ? `Tel: ${company.phone}<br>` : ''}
              ${company.email ? `Email: ${company.email}` : ''}
            </div>

            <!-- Client Details Section -->
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e9ecef;">
              <div class="section-title" style="font-size: 12px; font-weight: bold; color: hsl(var(--primary)); margin-bottom: 8px; text-transform: uppercase;">${data.type === 'lpo' ? 'Supplier' : 'Client'}</div>
              <div class="customer-name" style="font-size: 14px; font-weight: bold; margin-bottom: 5px; color: #212529;">${data.customer.name}</div>
              <div class="customer-details" style="font-size: 10px; color: #666; line-height: 1.4;">
                ${data.customer.email ? `${data.customer.email}<br>` : ''}
                ${data.customer.phone ? `${data.customer.phone}<br>` : ''}
                ${data.customer.address ? `${data.customer.address}<br>` : ''}
                ${data.customer.city ? `${data.customer.city}` : ''}
                ${data.customer.country ? `, ${data.customer.country}` : ''}
              </div>
            </div>
          </div>

          <div class="document-info">
            <div class="document-title">${documentTitle}</div>
            <div class="document-details">
              <table>
                <tr>
                  <td class="label">${data.type === 'receipt' ? 'Receipt #' : data.type === 'remittance' ? 'Advice #' : data.type === 'lpo' ? 'LPO #' : documentTitle + ' #'}:</td>
                  <td class="value">${data.number}</td>
                </tr>
                <tr>
                  <td class="label">${data.type === 'lpo' ? 'Order Date' : 'Date'}:</td>
                  <td class="value">${formatDate(data.date)}</td>
                </tr>
                ${data.due_date ? `
                <tr>
                  <td class="label">${data.type === 'lpo' ? 'Expected Delivery' : 'Due Date'}:</td>
                  <td class="value">${formatDate(data.due_date)}</td>
                </tr>
                ` : ''}
                ${data.valid_until ? `
                <tr>
                  <td class="label">Valid Until:</td>
                  <td class="value">${formatDate(data.valid_until)}</td>
                </tr>
                ` : ''}
                ${data.lpo_number && data.type !== 'lpo' ? `
                <tr>
                  <td class="label">LPO Number:</td>
                  <td class="value">${data.lpo_number}</td>
                </tr>
                ` : ''}
                <tr>
                  <td class="label">${data.type === 'receipt' ? 'Amount Paid' : data.type === 'remittance' ? 'Total Payment' : data.type === 'lpo' ? 'Order Total' : 'Amount'}:</td>
                  <td class="value" style="font-weight: bold; color: ${data.type === 'receipt' ? 'hsl(var(--primary))' : 'hsl(var(--primary))'};">${formatCurrency(data.total_amount)}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <!-- Delivery Information Section (for delivery notes) -->
        ${data.type === 'delivery' ? `
        <div class="delivery-info-section">
          <div class="section-title">Delivery Information</div>
          <div class="delivery-details">
            <div class="delivery-row">
              ${data.delivery_date ? `
              <div class="delivery-field">
                <div class="field-label">Delivery Date:</div>
                <div class="field-value">${new Date(data.delivery_date).toLocaleDateString()}</div>
              </div>
              ` : ''}
              ${data.delivery_method ? `
              <div class="delivery-field">
                <div class="field-label">Delivery Method:</div>
                <div class="field-value">${data.delivery_method}</div>
              </div>
              ` : ''}
            </div>

            ${data.delivery_address ? `
            <div class="delivery-row">
              <div class="delivery-field full-width">
                <div class="field-label">Delivery Address:</div>
                <div class="field-value">${data.delivery_address}</div>
              </div>
            </div>
            ` : ''}

            <div class="delivery-row">
              ${data.carrier ? `
              <div class="delivery-field">
                <div class="field-label">Carrier:</div>
                <div class="field-value">${data.carrier}</div>
              </div>
              ` : ''}
              ${data.tracking_number ? `
              <div class="delivery-field">
                <div class="field-label">Tracking Number:</div>
                <div class="field-value">${data.tracking_number}</div>
              </div>
              ` : ''}
            </div>

            <div class="delivery-row">
              ${data.delivered_by ? `
              <div class="delivery-field">
                <div class="field-label">Delivered By:</div>
                <div class="field-value">${data.delivered_by}</div>
              </div>
              ` : ''}
              ${data.received_by ? `
              <div class="delivery-field">
                <div class="field-label">Received By:</div>
                <div class="field-value">${data.received_by}</div>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Items Section -->
        ${data.items && data.items.length > 0 ? `
        <div class="items-section">
          <table class="items-table">
            <thead>
              <tr>
                ${data.type === 'delivery' ? `
                <th style="width: 5%;">#</th>
                <th style="width: 40%;">Item Description</th>
                <th style="width: 15%;">Ordered Qty</th>
                <th style="width: 15%;">Delivered Qty</th>
                <th style="width: 15%;">Unit</th>
                <th style="width: 10%;">Status</th>
                ` : data.type === 'statement' ? `
                <th style="width: 12%;">Date</th>
                <th style="width: 25%;">Description</th>
                <th style="width: 15%;">Reference</th>
                <th style="width: 12%;">Debit</th>
                <th style="width: 12%;">Credit</th>
                <th style="width: 12%;">Balance</th>
                ` : data.type === 'remittance' ? `
                <th style="width: 15%;">Date</th>
                <th style="width: 15%;">Document Type</th>
                <th style="width: 20%;">Document Number</th>
                <th style="width: 16%;">Invoice Amount</th>
                <th style="width: 16%;">Credit Amount</th>
                <th style="width: 18%;">Payment Amount</th>
                ` : data.type === 'boq' ? `
                <th style="width: 5%;">#</th>
                <th style="width: 45%;">Item Description</th>
                <th style="width: 10%;">Qty</th>
                <th style="width: 10%;">Unit</th>
                <th style="width: 15%;">Rate</th>
                <th style="width: 15%;">Amount</th>
                ` : `
                <th style="width: 5%;">#</th>
                <th style="width: ${visibleColumns.discountPercentage || visibleColumns.discountBeforeVat || visibleColumns.discountAmount || visibleColumns.taxPercentage || visibleColumns.taxAmount ? '30%' : '40%'};">Description</th>
                <th style="width: 10%;">Qty</th>
                <th style="width: 15%;">Unit Price</th>
                ${visibleColumns.discountPercentage ? '<th style=\"width: 10%;\">Disc %</th>' : ''}
                ${visibleColumns.discountBeforeVat ? '<th style=\"width: 12%;\">Disc Before VAT</th>' : ''}
                ${visibleColumns.discountAmount ? '<th style=\"width: 12%;\">Disc Amount</th>' : ''}
                ${visibleColumns.taxPercentage ? '<th style=\"width: 10%;\">Tax %</th>' : ''}
                ${visibleColumns.taxAmount ? '<th style=\"width: 12%;\">Tax Amount</th>' : ''}
                <th style="width: 15%;">Total</th>
                `}
              </tr>
            </thead>
            <tbody>
              ${data.items.map((item, index) => `
                <tr>
                  ${data.type === 'statement' ? `
                  <td>${formatDate((item as any).transaction_date)}</td>
                  <td class="description-cell">${item.description}</td>
                  <td>${(item as any).reference}</td>
                  <td class="amount-cell">${(item as any).debit > 0 ? formatCurrency((item as any).debit) : ''}</td>
                  <td class="amount-cell">${(item as any).credit > 0 ? formatCurrency((item as any).credit) : ''}</td>
                  <td class="amount-cell">${formatCurrency(item.line_total)}</td>
                  ` : data.type === 'remittance' ? `
                  <td>${formatDate((item as any).document_date)}</td>
                  <td>${(item as any).description ? (item as any).description.split(':')[0] : 'Payment'}</td>
                  <td>${(item as any).description ? (item as any).description.split(':')[1] || (item as any).description : ''}</td>
                  <td class="amount-cell">${(item as any).invoice_amount ? formatCurrency((item as any).invoice_amount) : ''}</td>
                  <td class="amount-cell">${(item as any).credit_amount ? formatCurrency((item as any).credit_amount) : ''}</td>
                  <td class="amount-cell" style="font-weight: bold;">${formatCurrency(item.line_total)}</td>
                  ` : `
                  <td>${index + 1}</td>
                  <td class="description-cell">${item.description}</td>
                  ${data.type === 'delivery' ? `
                  <td>${(item as any).quantity_ordered || item.quantity}</td>
                  <td style="font-weight: bold; color: ${(item as any).quantity_delivered >= (item as any).quantity_ordered ? 'hsl(var(--primary))' : '#F59E0B'};">${(item as any).quantity_delivered || item.quantity}</td>
                  <td>${(item as any).unit_of_measure || 'pcs'}</td>
                  <td style="font-size: 10px;">
                    ${(item as any).quantity_delivered >= (item as any).quantity_ordered ?
                      '<span style="color: hsl(var(--primary)); font-weight: bold;">✓ Complete</span>' :
                      '<span style="color: #F59E0B; font-weight: bold;">⚠ Partial</span>'
                    }
                  </td>
                  ` : data.type === 'boq' ? `
                  <td>${item.quantity}</td>
                  <td>${(item as any).unit_of_measure || (item as any).unit || 'Item'}</td>
                  <td class="amount-cell">${formatCurrency(item.unit_price)}</td>
                  <td class="amount-cell">${formatCurrency(item.line_total)}</td>
                  ` : `
                  <td>${item.quantity}</td>
                  <td class="amount-cell">${formatCurrency(item.unit_price)}</td>
                  ${visibleColumns.discountPercentage ? `<td>${item.discount_percentage || 0}%</td>` : ''}
                  ${visibleColumns.discountBeforeVat ? `<td>${(item.discount_before_vat || 0)}%</td>` : ''}
                  ${visibleColumns.discountAmount ? `<td class=\"amount-cell\">${formatCurrency(item.discount_amount || 0)}</td>` : ''}
                  ${visibleColumns.taxPercentage ? `<td>${item.tax_percentage || 0}%</td>` : ''}
                  ${visibleColumns.taxAmount ? `<td class=\"amount-cell\">${formatCurrency(item.tax_amount || 0)}</td>` : ''}
                  <td class="amount-cell">${formatCurrency(item.line_total)}</td>
                  `}
                  `}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
        
        <!-- Totals Section (not for delivery notes) -->
        ${data.type !== 'delivery' ? `
        <div class="totals-section">
          <table class="totals-table">
            ${data.subtotal ? `
            <tr class="subtotal-row">
              <td class="label">Subtotal:</td>
              <td class="amount">${formatCurrency(data.subtotal)}</td>
            </tr>
            ` : ''}
            ${data.tax_amount ? `
            <tr>
              <td class="label">Tax Amount:</td>
              <td class="amount">${formatCurrency(data.tax_amount)}</td>
            </tr>
            ` : ''}
            <tr class="total-row">
              <td class="label">${data.type === 'statement' ? 'TOTAL OUTSTANDING:' : 'TOTAL:'}</td>
              <td class="amount">${formatCurrency(data.total_amount)}</td>
            </tr>
            ${(data.type === 'invoice' || data.type === 'proforma') && data.paid_amount !== undefined ? `
            <tr class="payment-info">
              <td class="label">Paid Amount:</td>
              <td class="amount" style="color: hsl(var(--primary));">${formatCurrency(data.paid_amount || 0)}</td>
            </tr>
            <tr class="balance-info">
              <td class="label" style="font-weight: bold;">Balance Due:</td>
              <td class="amount" style="font-weight: bold; color: ${(data.balance_due || 0) > 0 ? '#DC2626' : 'hsl(var(--primary))'};">${formatCurrency(data.balance_due || 0)}</td>
            </tr>
            ` : ''}
          </table>
        </div>
        ` : ''}

        <!-- Signature Section (for delivery notes) -->
        ${data.type === 'delivery' ? `
        <div class="signature-section">
          <div class="signature-row">
            <div class="signature-box">
              <div class="signature-label">Delivered By:</div>
              <div class="signature-line">${data.delivered_by || '_________________________'}</div>
              <div class="signature-date">Date: ${data.delivery_date ? new Date(data.delivery_date).toLocaleDateString() : '__________'}</div>
            </div>
            <div class="signature-box">
              <div class="signature-label">Received By:</div>
              <div class="signature-line">${data.received_by || '_________________________'}</div>
              <div class="signature-date">Date: __________</div>
            </div>
          </div>
        </div>
        ` : ''}

        
        <!-- Bank Details (only for invoices and quotations) -->
        ${(data.type === 'invoice' || data.type === 'quotation') ? `
        <div class="bank-details">
          <strong>Payments to: Layons Construction Limited. For bank details, contact: layonscoltd@gmail.com / 0720717463</strong>
        </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer">
          <strong>Thank you for your business!</strong><br>
          <strong>${company.name}</strong><br>
          This document was generated on ${new Date().toLocaleString()}
          ${data.type === 'proforma' ? '<br><em>This is a proforma invoice and not a request for payment</em>' : ''}
          ${data.type === 'delivery' ? '<br><em>This delivery note confirms the items delivered</em>' : ''}
          ${data.type === 'receipt' ? '<br><em>This receipt serves as proof of payment received</em>' : ''}
          ${data.type === 'remittance' ? '<br><em>This remittance advice details payments made to your account</em>' : ''}
          ${data.type === 'lpo' ? '<br><em>This Local Purchase Order serves as an official request for goods/services</em>' : ''}
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Wait for content to load before printing
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  // Fallback if onload doesn't fire
  setTimeout(() => {
    if (printWindow && !printWindow.closed) {
      printWindow.print();
    }
  }, 1000);

  return printWindow;
};

// Specific function for invoice PDF generation
export const downloadInvoicePDF = async (invoice: any, documentType: 'INVOICE' | 'PROFORMA' = 'INVOICE', company?: CompanyDetails) => {
  const documentData: DocumentData = {
    type: documentType === 'PROFORMA' ? 'proforma' : 'invoice',
    number: invoice.invoice_number,
    date: invoice.invoice_date,
    due_date: invoice.due_date,
    lpo_number: invoice.lpo_number,
    company: company, // Pass company details
    customer: {
      name: invoice.customers?.name || 'Unknown Customer',
      email: invoice.customers?.email,
      phone: invoice.customers?.phone,
      address: invoice.customers?.address,
      city: invoice.customers?.city,
      country: invoice.customers?.country,
    },
    items: invoice.invoice_items?.map((item: any) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const taxAmount = Number(item.tax_amount || 0);
      const discountAmount = Number(item.discount_amount || 0);
      const computedLineTotal = quantity * unitPrice - discountAmount + taxAmount;

      return {
        description: item.description || item.product_name || item.products?.name || 'Unknown Item',
        quantity: quantity,
        unit_price: unitPrice,
        discount_percentage: Number(item.discount_percentage || 0),
        discount_before_vat: Number(item.discount_before_vat || 0),
        discount_amount: discountAmount,
        tax_percentage: Number(item.tax_percentage || 0),
        tax_amount: taxAmount,
        tax_inclusive: item.tax_inclusive || false,
        line_total: Number(item.line_total ?? computedLineTotal),
        unit_of_measure: item.products?.unit_of_measure || item.unit_of_measure || 'pcs',
      };
    }) || [],
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    total_amount: invoice.total_amount,
    paid_amount: invoice.paid_amount || 0,
    balance_due: invoice.balance_due || (invoice.total_amount - (invoice.paid_amount || 0)),
    notes: invoice.notes,
    terms_and_conditions: invoice.terms_and_conditions,
  };

  return generatePDF(documentData);
};

// Function for quotation PDF generation
export const downloadQuotationPDF = async (quotation: any, company?: CompanyDetails) => {
  const documentData: DocumentData = {
    type: 'quotation',
    number: quotation.quotation_number,
    date: quotation.quotation_date,
    valid_until: quotation.valid_until,
    company: company, // Pass company details
    customer: {
      name: quotation.customers?.name || 'Unknown Customer',
      email: quotation.customers?.email,
      phone: quotation.customers?.phone,
      address: quotation.customers?.address,
      city: quotation.customers?.city,
      country: quotation.customers?.country,
    },
    items: quotation.quotation_items?.map((item: any) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const taxAmount = Number(item.tax_amount || 0);
      const discountAmount = Number(item.discount_amount || 0);
      const computedLineTotal = quantity * unitPrice - discountAmount + taxAmount;

      return {
        description: item.description || item.product_name || item.products?.name || 'Unknown Item',
        quantity: quantity,
        unit_price: unitPrice,
        discount_percentage: Number(item.discount_percentage || 0),
        discount_amount: discountAmount,
        tax_percentage: Number(item.tax_percentage || 0),
        tax_amount: taxAmount,
        tax_inclusive: item.tax_inclusive || false,
        line_total: Number(item.line_total ?? computedLineTotal),
        unit_of_measure: item.products?.unit_of_measure || item.unit_of_measure || 'pcs',
      };
    }) || [],
    subtotal: quotation.subtotal,
    tax_amount: quotation.tax_amount,
    total_amount: quotation.total_amount,
    notes: quotation.notes,
    terms_and_conditions: quotation.terms_and_conditions,
  };

  return generatePDF(documentData);
};

// Function for generating customer statement PDF
export const generateCustomerStatementPDF = async (customer: any, invoices: any[], payments: any[], statementData?: any, company?: CompanyDetails) => {
  const today = new Date();
  const statementDate = statementData?.statement_date || today.toISOString().split('T')[0];

  // Calculate outstanding amounts
  const totalOutstanding = invoices.reduce((sum, inv) =>
    sum + ((inv.total_amount || 0) - (inv.paid_amount || 0)), 0
  );

  // Calculate aging buckets
  const current = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOverdue <= 0 && (inv.total_amount - (inv.paid_amount || 0)) > 0;
  }).reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const days30 = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOverdue > 0 && daysOverdue <= 30 && (inv.total_amount - (inv.paid_amount || 0)) > 0;
  }).reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const days60 = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOverdue > 30 && daysOverdue <= 60 && (inv.total_amount - (inv.paid_amount || 0)) > 0;
  }).reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const days90 = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOverdue > 60 && daysOverdue <= 90 && (inv.total_amount - (inv.paid_amount || 0)) > 0;
  }).reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const over90 = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOverdue > 90 && (inv.total_amount - (inv.paid_amount || 0)) > 0;
  }).reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  // Create all transactions (invoices and payments) with running balance
  const allTransactions = [
    // Add all invoices as debits
    ...invoices.map(inv => ({
      date: inv.invoice_date,
      type: 'invoice',
      reference: inv.invoice_number,
      description: `Invoice ${inv.invoice_number}`,
      debit: inv.total_amount || 0,
      credit: 0,
      due_date: inv.due_date
    })),
    // Add all payments as credits
    ...payments.map(pay => ({
      date: pay.payment_date,
      type: 'payment',
      reference: pay.payment_number || pay.id || 'PMT',
      description: `Payment - ${pay.method || 'Cash'}`,
      debit: 0,
      credit: pay.amount || 0,
      due_date: null
    }))
  ];

  // Sort by date
  allTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Calculate running balance
  let runningBalance = 0;
  const statementItems = allTransactions.map((transaction, index) => {
    runningBalance += transaction.debit - transaction.credit;

    return {
      description: transaction.description,
      quantity: 1,
      unit_price: Number(transaction.debit || transaction.credit || 0),
      tax_percentage: 0,
      tax_amount: 0,
      tax_inclusive: false,
      line_total: Number(runningBalance),
      balance: Number(runningBalance),
      transaction_date: transaction.date,
      transaction_type: transaction.type,
      reference: transaction.reference,
      debit: Number(transaction.debit || 0),
      credit: Number(transaction.credit || 0),
      due_date: transaction.due_date,
      days_overdue: transaction.due_date ? Math.max(0, Math.floor((today.getTime() - new Date(transaction.due_date).getTime()) / (1000 * 60 * 60 * 24))) : 0
    };
  });

  // Calculate final balance from last transaction
  const finalBalance = statementItems.length > 0 ? statementItems[statementItems.length - 1].line_total : 0;

  const documentData: DocumentData = {
    type: 'statement', // Use statement type for proper formatting
    number: `STMT-${customer.customer_code || customer.id}-${statementDate}`,
    date: statementDate,
    company: company, // Pass company details
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      country: customer.country,
    },
    items: statementItems,
    subtotal: finalBalance,
    tax_amount: 0,
    total_amount: finalBalance,
    notes: `Statement of Account as of ${new Date(statementDate).toLocaleDateString()}\n\nThis statement shows all transactions including invoices (debits) and payments (credits) with running balance.\n\nAging Summary for Outstanding Invoices:\nCurrent: $${current.toFixed(2)}\n1-30 Days: $${days30.toFixed(2)}\n31-60 Days: $${days60.toFixed(2)}\n61-90 Days: $${days90.toFixed(2)}\nOver 90 Days: $${over90.toFixed(2)}`,
    terms_and_conditions: 'Please remit payment for any outstanding amounts. Contact us if you have any questions about this statement.',
  };

  return generatePDF(documentData);
};

// Function for generating payment receipt PDF
export const generatePaymentReceiptPDF = async (payment: any, company?: CompanyDetails) => {
  const documentData: DocumentData = {
    type: 'receipt', // Use receipt type for payment receipts
    number: payment.number || payment.payment_number || `REC-${Date.now()}`,
    date: payment.date || payment.payment_date || new Date().toISOString().split('T')[0],
    company: company, // Pass company details
    customer: {
      name: payment.customer || payment.customers?.name || 'Unknown Customer',
      email: payment.customers?.email,
      phone: payment.customers?.phone,
    },
    total_amount: typeof payment.amount === 'string' ?
      parseFloat(payment.amount.replace('$', '').replace(',', '')) :
      payment.amount,
    notes: `Payment received via ${payment.payment_method?.replace('_', ' ') || payment.method?.replace('_', ' ') || 'Unknown method'}\n\nReference: ${payment.reference_number || 'N/A'}\nInvoice: ${payment.payment_allocations?.[0]?.invoice_number || 'N/A'}`,
    terms_and_conditions: 'Thank you for your payment. This receipt confirms that payment has been received and processed.',
  };

  return generatePDF(documentData);
};

// Function for generating remittance advice PDF
export const downloadRemittancePDF = async (remittance: any, company?: CompanyDetails) => {
  const documentData: DocumentData = {
    type: 'remittance',
    number: remittance.adviceNumber || remittance.advice_number || `REM-${Date.now()}`,
    date: remittance.adviceDate || remittance.advice_date || new Date().toISOString().split('T')[0],
    company: company, // Pass company details
    customer: {
      name: remittance.customerName || remittance.customers?.name || 'Unknown Customer',
      email: remittance.customers?.email,
      phone: remittance.customers?.phone,
      address: remittance.customers?.address,
      city: remittance.customers?.city,
      country: remittance.customers?.country,
    },
    items: (remittance.remittance_advice_items || remittance.items || []).map((item: any) => ({
      description: item.document_number
        ? `${item.document_type === 'invoice' ? 'Invoice' : item.document_type === 'credit_note' ? 'Credit Note' : 'Payment'}: ${item.document_number}`
        : item.description
        || `Payment for ${item.invoiceNumber || item.creditNote || 'Document'}`,
      quantity: 1,
      unit_price: item.payment_amount || item.payment || 0,
      tax_percentage: item.tax_percentage || 0,
      tax_amount: item.tax_amount || 0,
      tax_inclusive: item.tax_inclusive || false,
      line_total: item.payment_amount || item.payment || 0,
      // Additional details for remittance-specific display
      document_date: item.document_date || item.date,
      invoice_amount: item.invoice_amount || item.invoiceAmount,
      credit_amount: item.credit_amount || item.creditAmount,
    })),
    subtotal: remittance.totalPayment || remittance.total_payment || 0,
    tax_amount: 0,
    total_amount: remittance.totalPayment || remittance.total_payment || 0,
    notes: remittance.notes || 'Remittance advice for payments made',
    terms_and_conditions: 'This remittance advice details payments made to your account.',
  };

  return generatePDF(documentData);
};

// Function for delivery note PDF generation
export const downloadDeliveryNotePDF = async (deliveryNote: any, company?: CompanyDetails) => {
  // Get invoice information for reference
  const invoiceNumber = deliveryNote.invoice_number ||
                       deliveryNote.invoices?.invoice_number ||
                       (deliveryNote.invoice_id ? `INV-${deliveryNote.invoice_id.slice(-8)}` : 'N/A');

  const documentData: DocumentData = {
    type: 'delivery',
    number: deliveryNote.delivery_note_number || deliveryNote.delivery_number,
    date: deliveryNote.delivery_date,
    delivery_date: deliveryNote.delivery_date,
    delivery_address: deliveryNote.delivery_address,
    delivery_method: deliveryNote.delivery_method,
    carrier: deliveryNote.carrier,
    tracking_number: deliveryNote.tracking_number,
    delivered_by: deliveryNote.delivered_by,
    received_by: deliveryNote.received_by,
    // Add invoice reference for delivery notes
    lpo_number: `Related Invoice: ${invoiceNumber}`,
    company: company, // Pass company details
    customer: {
      name: deliveryNote.customers?.name || 'Unknown Customer',
      email: deliveryNote.customers?.email,
      phone: deliveryNote.customers?.phone,
      address: deliveryNote.customers?.address,
      city: deliveryNote.customers?.city,
      country: deliveryNote.customers?.country,
    },
    items: (deliveryNote.delivery_note_items || deliveryNote.delivery_items)?.map((item: any, index: number) => ({
      description: `${item.products?.name || item.product_name || item.description || 'Unknown Item'}${invoiceNumber !== 'N/A' ? ` (From Invoice: ${invoiceNumber})` : ''}`,
      quantity: item.quantity_delivered || item.quantity || 0,
      unit_price: 0, // Not relevant for delivery notes
      tax_percentage: 0,
      tax_amount: 0,
      tax_inclusive: false,
      line_total: 0,
      unit_of_measure: item.products?.unit_of_measure || item.unit_of_measure || 'pcs',
      // Add delivery-specific details
      quantity_ordered: item.quantity_ordered || item.quantity || 0,
      quantity_delivered: item.quantity_delivered || item.quantity || 0,
    })) || [],
    total_amount: 0, // Not relevant for delivery notes
    notes: deliveryNote.notes || `Items delivered as per Invoice ${invoiceNumber}`,
  };

  return generatePDF(documentData);
};

// Function for LPO PDF generation
export const downloadLPOPDF = async (lpo: any, company?: CompanyDetails) => {
  const documentData: DocumentData = {
    type: 'lpo', // Use LPO document type
    number: lpo.lpo_number,
    date: lpo.lpo_date,
    due_date: lpo.delivery_date,
    delivery_date: lpo.delivery_date,
    delivery_address: lpo.delivery_address,
    company: company, // Pass company details
    customer: {
      name: lpo.suppliers?.name || 'Unknown Supplier',
      email: lpo.suppliers?.email,
      phone: lpo.suppliers?.phone,
      address: lpo.suppliers?.address,
      city: lpo.suppliers?.city,
      country: lpo.suppliers?.country,
    },
    items: lpo.lpo_items?.map((item: any) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const taxAmount = Number(item.tax_amount || 0);
      const computedLineTotal = quantity * unitPrice + taxAmount;

      return {
        description: item.description || item.products?.name || 'Unknown Item',
        quantity: quantity,
        unit_price: unitPrice,
        discount_percentage: 0,
        discount_amount: 0,
        tax_percentage: Number(item.tax_rate || 0),
        tax_amount: taxAmount,
        tax_inclusive: false,
        line_total: Number(item.line_total ?? computedLineTotal),
        unit_of_measure: item.products?.unit_of_measure || 'pcs',
      };
    }) || [],
    subtotal: lpo.subtotal,
    tax_amount: lpo.tax_amount,
    total_amount: lpo.total_amount,
    notes: `${lpo.notes || ''}${lpo.contact_person ? `\n\nContact Person: ${lpo.contact_person}` : ''}${lpo.contact_phone ? `\nContact Phone: ${lpo.contact_phone}` : ''}`.trim(),
    terms_and_conditions: lpo.terms_and_conditions,
  };

  return generatePDF(documentData);
};
