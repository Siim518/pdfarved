const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
    // 1) Parse incoming form data
    const data = JSON.parse(event.body);
    const {
      arve_nr, saaja_nimi, saaja_firma, saaja_regnr, saaja_kmkr, saaja_aadress,
      products, email
    } = data;

    if (!Array.isArray(products) || products.length === 0) {
      throw new Error('No products provided');
    }
    if (!email) {
      throw new Error('No email provided');
    }

    // 2) Create PDF
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // 3) Place the logo top-left
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 80 });

    // We'll start both columns at y=140 so they're on the same horizontal line
    const topOfColumns = 140;

    // Left column (Seller info) at x=50, y=140
    const sellerX = 50;
    doc.fontSize(10);

    const sellerInfo = `Benaks OÜ
Reg.nr. 12069824
KMKR nr. EE101433055
Telefon: +372 5182792
E-post: benaksinfo@gmail.com
Hoburaua tee 8a, Randvere küla,
Viimsi vald, Harju maakond, 74016`;

    doc.text(sellerInfo, sellerX, topOfColumns, { width: 200 });
    const finalSellerY = doc.y;

    // Right column (Client info) at x=300, y=140
    let clientX = 300;
    let clientY = topOfColumns;

    doc.text(`ARVE NR: ${arve_nr || '-'}`, clientX, clientY);
    clientY += 14;
    doc.text(`Saaja nimi: ${saaja_nimi || '-'}`, clientX, clientY);
    clientY += 14;
    doc.text(`Saaja firma: ${saaja_firma || '-'}`, clientX, clientY);
    clientY += 14;
    doc.text(`Saaja reg.nr: ${saaja_regnr || '-'}`, clientX, clientY);
    clientY += 14;
    doc.text(`Saaja KMKR: ${saaja_kmkr || '-'}`, clientX, clientY);
    clientY += 14;
    doc.text(`Saaja aadress: ${saaja_aadress || '-'}`, clientX, clientY);
    clientY += 14;

    const finalClientY = clientY;
    const endOfColumns = Math.max(finalSellerY, finalClientY);
    doc.y = endOfColumns + 30;

    // Table headers on one baseline
    const headingY = doc.y;
    doc.text('Nimi', 50, headingY, { width: 150 });
    doc.text('Kogus', 210, headingY, { width: 50 });
    doc.text('Hind ilma KM', 270, headingY, { width: 100 });
    doc.text('Hind koos KM', 390, headingY, { width: 100 });

    // Draw line below headers
    doc.moveTo(50, headingY + 12)
       .lineTo(500, headingY + 12)
       .stroke();

    // Move down to start listing products
    doc.y = headingY + 20;

    let totalNet = 0;
    let totalGross = 0;

    // 6) List products
    products.forEach((p) => {
      const rowY = doc.y;

      // Calculate net price if 22% vat
      const netEach = p.price_gross / 1.22;
      const lineNet = netEach * p.qty;
      const lineGross = p.price_gross * p.qty;

      totalNet += lineNet;
      totalGross += lineGross;

      doc.text(p.name, 50, rowY, { width: 150 });
      doc.text(p.qty.toString(), 210, rowY, { width: 50 });
      doc.text(lineNet.toFixed(2) + ' €', 270, rowY, { width: 100 });
      doc.text(lineGross.toFixed(2) + ' €', 390, rowY, { width: 100 });

      doc.moveDown(1);
    });

    const vat = totalGross - totalNet;

    doc.moveDown(1);
    const lineY = doc.y;
    doc.moveTo(50, lineY).lineTo(500, lineY).stroke();
    doc.moveDown(1);

    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);
    doc.text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    doc.moveDown(2);
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9)
       .text('Benaks OÜ IBAN: EE832200221051880171');

    // Finalize PDF
    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // 7) Upload to Drive with metadata in 'description'
    const folderId = '13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO'; // your new folder
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    const drive = google.drive({ version: 'v3', auth });

    // We embed Invoice Nr, Name, Email in the description:
    const metaObj = {
      invoiceNr: arve_nr,
      name: saaja_nimi,
      email: email
    };

    await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/pdf',
        parents: [folderId],
        description: JSON.stringify(metaObj)
      },
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      }
    });

    // 8) Send Email (from your new Gmail)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `Benaks OÜ <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Arve ${arve_nr || '-'}`,
      text: 'Arve on lisatud manusena.',
      attachments: [{ filename: fileName, path: filePath }]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
