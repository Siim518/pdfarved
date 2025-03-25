const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
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

    // 1) Create PDF
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // 2) Logo
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 80 });

    // 3) Columns at y=140
    const topOfColumns = 140;

    // LEFT column (Seller info)
    let sellerX = 50;
    doc.fontSize(10); // normal for seller info text

    const sellerInfo = `Benaks OÜ
Reg.nr. 12069824
KMKR nr. EE101433055
Telefon: +372 5182792
E-post: benaksinfo@gmail.com
Hoburaua tee 8a, Randvere küla,
Viimsi vald, Harju maakond, 74016`;

    doc.text(sellerInfo, sellerX, topOfColumns, { width: 200 });
    const finalSellerY = doc.y;

    // RIGHT column (Client info) at x=300
    let clientX = 300;
    let clientY = topOfColumns;

    // **BOLD + 20 px** for "ARVE NR:"
    doc.font('Helvetica-Bold').fontSize(20).text(`ARVE NR: ${arve_nr || '-'}`, clientX, clientY);
    clientY += 24; // move down ~24 points (since fontSize=20, give a bit extra spacing)

    // Switch back to normal 10 px for the rest
    doc.font('Helvetica').fontSize(10).text(`Saaja nimi: ${saaja_nimi || '-'}`, clientX, clientY);
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

    // TABLE HEADERS
    // **BOLD + 20 px** for Nimi, Kogus, Hind ilma KM, Hind koos KM
    doc.font('Helvetica-Bold').fontSize(20);
    const headingY = doc.y;

    doc.text('Nimi', 50, headingY, { width: 150 });
    doc.text('Kogus', 210, headingY, { width: 50 });
    doc.text('Hind ilma KM', 270, headingY, { width: 100 });
    doc.text('Hind koos KM', 390, headingY, { width: 100 });

    doc.moveTo(50, headingY + 22).lineTo(500, headingY + 22).stroke();
    doc.y = headingY + 30;

    // Switch back to normal 10 px for the product rows
    doc.font('Helvetica').fontSize(10);

    let totalNet = 0;
    let totalGross = 0;

    products.forEach((p) => {
      const rowY = doc.y;
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

    // **BOLD + 20 px** for totals
    doc.font('Helvetica-Bold').fontSize(20);
    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);
    doc.text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    // Switch back to normal for the final lines
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(10);
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171');

    // finalize
    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // (Drive upload + email code remains the same as before)
    // ...

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
