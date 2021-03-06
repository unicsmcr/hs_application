import { Request, Response } from 'express';
import autoBind from 'auto-bind';
import { provide } from 'inversify-binding-decorators';
import { ReviewService, ApplicantService, EmailService, EmailType } from '../services';
import { Applicant, Review } from '../models/db';
import { HttpResponseCode } from '../util/errorHandling';
import { User } from '@unicsmcr/hs_auth_client';
import { reviewApplicationMapping, logger } from '../util';
import { ApplicantStatus } from '../services/applications/applicantStatus';
import * as pages from '../views/page';
import { CommonController } from './commonController';
import { Cache } from '../util/cache';
import { HackathonConfig } from '../models';
import { AppConfig } from '../settings';

export interface ReviewControllerInterface {
	submit: (req: Request, res: Response) => Promise<void>;
	reviewPage: (req: Request, res: Response) => Promise<void>;
	nextReview: (req: Request, res: Response) => Promise<void>;
}

/**
 * A controller for review methods
 */
@provide(ReviewController)
export class ReviewController extends CommonController implements ReviewControllerInterface {
	private readonly _reviewService: ReviewService;
	private readonly _applicantService: ApplicantService;
	private readonly _emailService: EmailService;
	private readonly hackathonSettings: AppConfig;

	public constructor(
		reviewService: ReviewService,
		applicantService: ApplicantService,
		emailService: EmailService,
		cache: Cache
	) {
		super();
		this._reviewService = reviewService;
		this._applicantService = applicantService;
		this._emailService = emailService;
		this.hackathonSettings = cache.getAll<HackathonConfig>(HackathonConfig.name)[0].config;

		autoBind(this);
	}

	public reviewPage(req: Request, res: Response): Promise<void> {
		return super.renderPage(req, res, pages.review, {});
	}

	public async nextReview(req: Request, res: Response): Promise<void> {
		let nextApplication: Applicant | undefined;
		try {
			nextApplication = await this._reviewService.getNextApplication((req.user as User).id);
			if (!nextApplication) throw new Error('No new application');
		} catch (err) {
			res.status(HttpResponseCode.INTERNAL_ERROR).send({ message: 'Failed to get another application' });
			return;
		}

		let totalReviewsByUser: number;
		try {
			totalReviewsByUser = await this._reviewService.getReviewCountByAuthID((req.user as User).id);
		} catch (err) {
			res.status(HttpResponseCode.INTERNAL_ERROR).send({ message: 'Failed to get another application' });
			return;
		}

		res.send({
			application: nextApplication,
			reviewFields: Array.from(reviewApplicationMapping),
			totalReviews: totalReviewsByUser
		});
	}

	public async submit(req: Request, res: Response): Promise<void> {
		const { applicationID, averageScore } = req.body;

		// Find the applicant by the provided ID
		let application: Applicant;
		try {
			application = await this._applicantService.findOne(applicationID);
		} catch (err) {
			res.status(HttpResponseCode.INTERNAL_ERROR).send({
				message: 'Failed to save application review'
			});
			return;
		}

		const newReview = new Review();
		newReview.createdByAuthID = (req.user as User).id;
		newReview.applicant = application;
		newReview.averageScore = averageScore;

		let reviewCountForApplicant;
		try {
			reviewCountForApplicant = await this._reviewService.getReviewCountByApplicantID(applicationID);
		} catch (err) {
			res.status(HttpResponseCode.INTERNAL_ERROR).send({
				message: 'Failed to get review count'
			});
			return;
		}

		// Only update the application state when they have had at least one review
		if (reviewCountForApplicant >= 1) {
			application.applicationStatus = ApplicantStatus.Reviewed;
			try {
				await this._applicantService.save(application);
			} catch (err) {
				res.status(HttpResponseCode.INTERNAL_ERROR).send({
					message: 'Failed to update applicant with reviewed state'
				});
				return;
			}
		}

		try {
			await this._reviewService.save(newReview);
		} catch (err) {
			res.status(HttpResponseCode.INTERNAL_ERROR).send({
				message: 'Failed to save application review'
			});
			return;
		}
		reviewCountForApplicant++;

		const minimumReviews = this.hackathonSettings.review.minimumReviews;
		if (reviewCountForApplicant >= minimumReviews) {
			try {
				await this._emailService.sendEmail(application, EmailType.INVITE);

				const acceptDeadline = new Date();
				acceptDeadline.setDate(acceptDeadline.getDate() + 5);
				await this._applicantService.save({
					...application,
					inviteAcceptDeadline: acceptDeadline,
					applicationStatus: ApplicantStatus.Invited
				});
			} catch (err) {
				logger.error('failed to send invite');
				logger.error(err);
				res.status(HttpResponseCode.INTERNAL_ERROR).send({
					message: 'Failed to send invite to user'
				});
				return;
			}
		}

		res.send({ message: 'Saved review' });
	}
}
