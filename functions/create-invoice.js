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
            throw new Error('Products array is empty or invalid');
        }

        const doc = new PDFDocument({ margin: 50 });
        const fileName = `invoice-${arve_nr}.pdf`;
        const filePath = `/tmp/${fileName}`;
        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);

        const logoPath = path.join(__dirname, 'benaks-logo.png');
        doc.image(logoPath, 50, 50, { width: 100 });

        doc.fontSize(10).text('Benaks OÜ', 400, 50)
            .text('Reg.nr. 12069824')
            .text('KMKR nr. EE101433055')
            .text('Telefon: +372 5182792')
            .text('E-post: benaksinfo@gmail.com')
            .text('Hoburaua tee 8a, Randvere küla, Viimsi vald, Harju maakond, 74016');

        doc.moveDown(2);
        doc.fontSize(12).text(`ARVE NR: ${arve_nr}`);
        doc.moveDown(1);

        doc.fontSize(10).text(`Saaja nimi: ${saaja_nimi}`)
            .text(`Saaja firma: ${saaja_firma}`)
            .text(`Saaja reg.nr: ${saaja_regnr}`)
            .text(`Saaja KMKR: ${saaja_kmkr}`)
            .text(`Saaja aadress: ${saaja_aadress}`);

        doc.moveDown(2);

        doc.fontSize(10).text('Toode/Teenused', 50, doc.y, { width: 200 })
            .text('Kogus', 260, doc.y, { width: 50 })
            .text('Hind', 320, doc.y, { width: 50 })
            .text('Kokku', 400, doc.y, { width: 100 });

        doc.moveTo(50, doc.y + 5).lineTo(500, doc.y + 5).stroke();
        doc.moveDown(0.5);

        let total_no_vat = 0;
        products.forEach(p => {
            const lineTotal = p.qty * p.unit_price;
            total_no_vat += lineTotal;

            doc.text(p.name, 50, doc.y, { width: 200 })
                .text(p.qty.toString(), 260, doc.y, { width: 50 })
                .text(p.unit_price.toFixed(2), 320, doc.y, { width: 50 })
                .text(lineTotal.toFixed(2) + ' €', 400, doc.y, { width: 100 });

            doc.moveDown(0.5);
        });

        const vat = total_no_vat * 0.22;
        const total_with_vat = total_no_vat + vat;

        doc.moveDown(1);
        doc.text(`Summa ilma KM-ta: ${total_no_vat.toFixed(2)} €`);
        doc.text(`KM (22%): ${vat.toFixed(2)} €`);
        doc.text(`Kokku: ${total_with_vat.toFixed(2)} €`);

        doc.moveDown(2);
        doc.text('Maksetähtaeg: 7 päeva', { align: 'left' });
        doc.text('Viivis: 0.05% päevas', { align: 'left' });

        doc.moveDown(2);
        doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171', { align: 'left' });

        doc.end();

        await new Promise(resolve => writeStream.on('finish', resolve));

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
            subject: `Arve ${arve_nr} - Benaks OÜ`,
            text: 'Arve on lisatud manusena.',
            attachments: [{ filename: fileName, path: filePath }]
        });

        return { statusCode: 200, body: JSON.stringify({ success: true }) };

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message || 'Unknown error' })
        };
    }
};
