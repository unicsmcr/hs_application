import { Request, Response, NextFunction } from 'express';
import { Cache } from '../util/cache';
import { Sections } from '../models/sections';
import { inject, injectable } from 'inversify';
import { TYPES } from '../types';
import { ApplicantService } from '../services';
import { Applicant } from '../models/db';
import { HttpResponseCode } from '../util/errorHandling';
import { User } from '@unicsmcr/hs_auth_client';
import { ApplicantStatus } from '../services/applications/applicantStatus';
import { applicationMapping } from '../util/decorator';
import { logger } from '../util';

export interface ApplicationControllerInterface {
	apply: (req: Request, res: Response, next: NextFunction) => void;
	updateUnsubmittedApplication: (req: Request, res: Response) => void;
	submitApplication: (req: Request, res: Response, next: NextFunction) => void;
	cancel: (req: Request, res: Response, next: NextFunction) => void;
	checkin: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * A controller for application methods
 */
@injectable()
export class ApplicationController implements ApplicationControllerInterface {
	private readonly _cache: Cache;
	private readonly _applicantService: ApplicantService;

	// TODO: Issue #10. Refactor error messages into something consistant across the project
	private readonly applicantNotFound = 'Applicant does not exist';

	public constructor(
	@inject(TYPES.Cache) cache: Cache,
		@inject(TYPES.ApplicantService) applicantService: ApplicantService
	) {
		this._cache = cache;
		this._applicantService = applicantService;
	}

	public apply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		const authID = (req.user as User).id;

		// Check if the user has started an application using the current auth ID
		let partialApplication;
		try {
			partialApplication = await this._applicantService.findPartialApplication(authID);
		} catch (err) {
			if (!(err?.message as string).includes(this.applicantNotFound)) {
				return next(err);
			}
		}

		// Check if the user has already submitted an application
		try {
			// If the user has made an application, the findOne call succeeds an we redirect
			// Otherwise, it throws an error
			await this._applicantService.findOne(authID, 'authId');
			return res.redirect('/');
		} catch (err) {
			if (!(err?.message as string).includes(this.applicantNotFound)) {
				return next(err);
			}
		}

		const cachedSections: Array<Sections> = this._cache.getAll(Sections.name);
		const sections = cachedSections[0].sections;
		res.render('pages/apply', { sections, partialApplication });
	};

	public updateUnsubmittedApplication = async (req: Request, res: Response): Promise<void> => {
		// The application is not yet complete, but save the partial application for the applicant
		await this._applicantService.savePartialApplication((req.user as User).id, req.body);

		res.send('Success!');
	};

	public submitApplication = async (req: Request, res: Response): Promise<void> => {
		const reqUser: User = req.user as User;

		const applicationFields: any = req.body;
		const newApplication: any = new Applicant();

		for (const [name, options] of applicationMapping.entries()) {
			if (options.hasOther) {
				newApplication[name] = applicationFields[`${name}Other`] || applicationFields[name] || 'Other';
			} else if (options.isNumeric) {
				const fieldToCastNumeric = applicationFields[name];
				(newApplication)[name] = this.isNumeric(fieldToCastNumeric) ? Number(fieldToCastNumeric) : undefined;
			} else {
				(newApplication)[name] = applicationFields[name];
			}
		}
		newApplication.authId = (req.user as User).id;
		newApplication.applicationStatus = ApplicantStatus.Applied;

		// Handling the CV file
		let cvFile: Buffer = Buffer.from('');
		const files = req.files as Express.Multer.File[] | undefined;
		if (files && files.length === 1 && files[0].fieldname === 'cv') {
			// Remove all non-ascii characters from the name and filename
			/* eslint no-control-regex: "off" */
			const nameCleaned: string = reqUser.name.replace(/[^\x00-\x7F]/g, '');
			const fileNameCleaned: string = files[0].originalname.replace(/[^\x00-\x7F]/g, '');
			newApplication.cv = `${nameCleaned}.${reqUser.email}.${fileNameCleaned}`;
			cvFile = files[0].buffer;
		}

		try {
			await this._applicantService.save(newApplication, cvFile);
		} catch (errors) {
			logger.error(errors);
			res.status(HttpResponseCode.BAD_REQUEST).send({
				error: true,
				message: 'Could not create application!'
			});
			return;
		}
		res.send({
			message: 'Application recieved!'
		});
	};

	public cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		let application: Applicant;
		try {
			application = await this._applicantService.findOne((req.user as User).id, 'authId');
		} catch (err) {
			return next(err);
		}

		if (application.applicationStatus <= ApplicantStatus.Applied && res.locals.applicationsOpen) {
			// Delete the application so they can re-apply
			try {
				await this._applicantService.delete(application.id);
			} catch (err) {
				return next(err);
			}
		} else {
			// It is too late in the process to re-apply so cancel their application
			try {
				application.applicationStatus = ApplicantStatus.Cancelled;
				await this._applicantService.save(application);
			} catch (err) {
				return next(err);
			}
		}

		res.redirect('/');
	};

	private isNumeric(n: any): boolean {
		return !isNaN(parseFloat(n)) && isFinite(n);
	}

	public checkin = async (req: Request, res: Response): Promise<void> => {
		const checkinID: string = req.params.id;
		let application: Applicant;
		try {
			application = await this._applicantService.findOne(checkinID);
		} catch (err) {
			res.status(HttpResponseCode.BAD_REQUEST).send({
				message: 'Hacker could not be checked in'
			});
			return;
		}

		if (application.applicationStatus === ApplicantStatus.Confirmed) {
			// Update the application to state that they have attended the hackathon
			application.applicationStatus = ApplicantStatus.Admitted;
			try {
				await this._applicantService.save(application);
			} catch (err) {
				res.status(HttpResponseCode.BAD_REQUEST).send({
					message: 'Hacker could not be checked in'
				});
				return;
			}
		} else {
			res.status(HttpResponseCode.BAD_REQUEST).send({
				message: 'Hacker cannot be accepted! Please notify organiser!'
			});
			return;
		}

		res.send({
			message: 'Hacker checked in!'
		});
	};
}
