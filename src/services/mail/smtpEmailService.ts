import EmailTemplate from 'email-templates';
import { createTransport, SentMessageInfo } from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import { EmailServiceInterface } from './emailService';

export class SMTPEmailService implements EmailServiceInterface {
	public async sendEmail(
		from: string,
		recipient: string,
		subject: string,
		template: string,
		locals: any
	): Promise<any> {
		const transport: Mail = createTransport({
			host: 'smtp.ethereal.email',
			port: 587,
			secure: false, // true for 465, false for other ports
			auth: {
				user: '', // generated ethereal user
				pass: '' // generated ethereal password
			}
		});

		const msgOptions = {
			from: from,
			to: recipient,
			subject: subject
		};

		const email = new EmailTemplate({
			message: msgOptions,
			views: {
				root: `${__dirname}../../../settings/emailTemplates`,
				options: {
					extension: 'ejs'
				}
			}
		});

		let info: SentMessageInfo;
		try {
			const emailHTML = await email.render(template, locals);
			info = await transport.sendMail({ ...msgOptions, html: emailHTML });
		} catch (err) {
			throw new Error('Failed to send email');
		}

		return info;
	}
}
