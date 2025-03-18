const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');

exports.handler = async (event) => {
    const { name, email, details, amount } = JSON.parse(event.body);

    const doc = new PDFDocument();
    const fileName = `invoice-${Date.now()}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.fontSize(20).text('Invoice', { align: 'center' });
    doc.moveDown();
    doc.text(`Customer: ${name}`);
    doc.text(`Email: ${email}`);
    doc.text(`Details: ${details}`);
    doc.text(`Total: €${amount}`);
    doc.end();

    await new Promise(resolve => writeStream.on('finish', resolve));

    // Send Email via Gmail SMTP
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: `"Your Store" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Your Invoice',
        text: 'Please find your invoice attached.',
        attachments: [{
            filename: fileName,
            path: filePath
        }]
    });

    // Upload to Google Drive
    const auth = new google.auth.JWT(
        process.env.GOOGLE_CLIENT_EMAIL,
        null,
        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/drive.file']
    );

    const drive = google.drive({ version: 'v3', auth });
    const driveResponse = await drive.files.create({
        requestBody: {
            name: fileName,
            mimeType: 'application/pdf'
        },
        media: {
            mimeType: 'application/pdf',
            body: fs.createReadStream(filePath)
        }
    });

    return {
        statusCode: 200,
        body: JSON.stringify({ success: true, fileId: driveResponse.data.id })
    };
};
