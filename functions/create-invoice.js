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

    // 2) Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // 3) Two-column layout: Left column = Logo + seller info, Right column = ARVE + customer info

    // 3A) Left column
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    // Place the logo top-left
    doc.image(logoPath, 50, 50, { width: 80 });

    // Then seller info below the logo (left column)
    let sellerX = 50;
    let sellerY = 140;
    doc.fontSize(10);

    const sellerInfo = `Benaks OÜ
Reg.nr. 12069824
KMKR nr. EE101433055
Telefon: +372 5182792
E-post: benaksinfo@gmail.com
Hoburaua tee 8a, Randvere küla,
Viimsi vald, Harju maakond, 74016`;

    // Print multiline text in left column
    doc.text(sellerInfo, sellerX, sellerY, { width: 200 });
    const finalSellerY = doc.y; // store end y for left column

    // 3B) Right column for invoice + customer info
    const rightColX = 300;
    let rightColY = 50; // same top as the logo

    doc.text(`ARVE NR: ${arve_nr || '-'}`, rightColX, rightColY);
    rightColY += 14;
    doc.text(`Saaja nimi: ${saaja_nimi || '-'}`, rightColX, rightColY);
    rightColY += 14;
    doc.text(`Saaja firma: ${saaja_firma || '-'}`, rightColX, rightColY);
    rightColY += 14;
    doc.text(`Saaja reg.nr: ${saaja_regnr || '-'}`, rightColX, rightColY);
    rightColY += 14;
    doc.text(`Saaja KMKR: ${saaja_kmkr || '-'}`, rightColX, rightColY);
    rightColY += 14;
    doc.text(`Saaja aadress: ${saaja_aadress || '-'}`, rightColX, rightColY);
    rightColY += 14;

    const finalCustomerY = rightColY;

    // 4) Move below BOTH columns
    const endOfColumns = Math.max(finalSellerY, finalCustomerY);
    doc.y = endOfColumns + 30;

    // 5) Product Table with net/gross columns
    doc.fontSize(10).text('Nimi', 50, doc.y, { width: 150 });
    doc.text('Kogus', 210, doc.y, { width: 50 });
    doc.text('Hind ilma KM', 270, doc.y, { width: 100 });
    doc.text('Hind koos KM', 390, doc.y, { width: 100 });

    // line below header
    doc.moveTo(50, doc.y + 12)
       .lineTo(500, doc.y + 12)
       .stroke();

    doc.moveDown(1);

    let totalNet = 0;
    let totalGross = 0;

    products.forEach((p) => {
      // net price if 22% vat
      const netPriceEach = p.price_gross / 1.22;
      const lineNet = netPriceEach * p.qty;
      const lineGross = p.price_gross * p.qty;

      totalNet += lineNet;
      totalGross += lineGross;

      // print row
      const rowY = doc.y;
      doc.text(p.name, 50, rowY, { width: 150 });
      doc.text(p.qty.toString(), 210, rowY, { width: 50 });
      doc.text(lineNet.toFixed(2) + ' €', 270, rowY, { width: 100 });
      doc.text(lineGross.toFixed(2) + ' €', 390, rowY, { width: 100 });
      doc.moveDown(1);
    });

    const vat = totalGross - totalNet;

    // 6) Draw a line + spacing
    doc.moveDown(1);
    const lineY = doc.y;
    doc.moveTo(50, lineY).lineTo(500, lineY).stroke();
    doc.moveDown(1);

    // 7) Totals
    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);
    doc.text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    doc.moveDown(2);
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171');

    // 8) Finalize PDF
    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // 9) Upload to Google Drive folder
    // If you have a folder named Invoices with ID: "11-WG0xQwc21r_yTuBQXD-IiBNMwf8fXp"
    const folderId = '11-WG0xQwc21r_yTuBQXD-IiBNMwf8fXp';
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/pdf',
        parents: [folderId]
      },
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      }
    });

    // 10) Send Email
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

    // Done
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
