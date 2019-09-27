import { Request, Response, NextFunction } from "express";
import { Cache } from "../util/cache";
import { Sections } from "../models/sections";
import { inject, injectable } from "inversify";
import { TYPES } from "../types";
import { ApplicantService } from "../services";
import { Applicant } from "../models/db";
import { HttpResponseCode } from "../util/errorHandling";
import { RequestUser } from "../util/auth";
import { ApplicantStatus } from "../services/applications/applicantStatus";

export interface IApplicationController {
  apply: (req: Request, res: Response, next: NextFunction) => void;
  submitApplication: (req: Request, res: Response, next: NextFunction) => void;
  cancel: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * A controller for application methods
 */
@injectable()
export class ApplicationController {
  private _cache: Cache;
  private _applicantService: ApplicantService;

  public constructor(
    @inject(TYPES.Cache) cache: Cache,
    @inject(TYPES.ApplicantService) applicantService: ApplicantService
  ) {
    this._cache = cache;
    this._applicantService = applicantService;
  }

  public apply = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check if the user has already made an application using req.user.auth_id
    let application: Applicant;
    try {
      application = await this._applicantService.findOne((req.user as RequestUser).auth_id, "authId");
    } catch (err) {
      return next(err);
    }

    if (application) {
      // The application has been made, redirect to dashboard
      return res.redirect("/");
    } else {
      const cachedSections: Array<Sections> = this._cache.getAll(Sections.name);
      const sections = cachedSections[0].sections;
      res.render("pages/apply", { sections: sections, hasApplied: false });
    }
  };

  public submitApplication = async (req: Request, res: Response, next: NextFunction) => {
    const reqUser: RequestUser = (req.user) as RequestUser;

    const {
      applicantAge,
      applicantGender,
      applicantGenderOther,
      applicantNationality,
      applicantCountry,
      applicantCity,
      applicantUniversity,
      applicantStudyYear,
      applicantWorkArea,
      applicantWorkAreaOther,
      applicantSkills,
      applicantHackathonCount,
      applicantWhyChoose,
      applicantPastProj,
      applicantHardwareReq,
      applicantDietaryRequirements,
      applicantDietaryRequirementsOther,
      applicantTShirt
    } = req.body;

    // TODO: Rewrite this to make it easier to add more attributes
    const newApplication: Applicant = new Applicant();
    newApplication.age = Number(applicantAge);
    newApplication.gender = applicantGender === "Other" ? (applicantGenderOther || "Other") : applicantGender;
    newApplication.nationality = applicantNationality;
    newApplication.country = applicantCountry;
    newApplication.city = applicantCity;
    newApplication.university = applicantUniversity;
    newApplication.yearOfStudy = applicantStudyYear;
    newApplication.workArea = applicantWorkArea === "Other" ? (applicantWorkAreaOther || "Other") : applicantWorkArea;
    newApplication.skills = applicantSkills;
    newApplication.hackathonCount = this.isNumeric(applicantHackathonCount) ? Number(applicantHackathonCount) : undefined;
    newApplication.whyChooseHacker = applicantWhyChoose;
    newApplication.pastProjects = applicantPastProj;
    newApplication.hardwareRequests = applicantHardwareReq;
    newApplication.dietaryRequirements = applicantDietaryRequirements === "Other" ? (applicantDietaryRequirementsOther || "Other") : applicantDietaryRequirements;
    newApplication.tShirtSize = applicantTShirt;
    newApplication.authId = (req.user as RequestUser).auth_id;
    newApplication.applicationStatus = ApplicantStatus.Applied;

    // Handling the CV file
    let cvFile: Buffer;
    if (req.files && req.files.length === 1 && req.files[0].fieldname === "applicantCV") {
      newApplication.cv = `${reqUser.name}.${reqUser.email}.${req.files[0].originalname}`;
      cvFile = req.files[0].buffer;
    }

    try {
      await this._applicantService.save(newApplication, cvFile);
    } catch (errors) {
      return res.status(HttpResponseCode.BAD_REQUEST).send({
        message: "Could not create application!"
      });
    }
    res.send({
      message: "Application recieved!"
    });
  };

  public cancel = async (req: Request, res: Response, next: NextFunction) => {
    let application: Applicant;
    try {
      application = await this._applicantService.findOne((req.user as RequestUser).auth_id, "authId");
    } catch (err) {
      return next(err);
    }


    if (application.applicationStatus <= ApplicantStatus.Applied) {
      // Delete the application so they can re-apply
      try {
        await this._applicantService.remove(application.id);
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

    res.redirect("/");
  };

  private isNumeric(n: any): boolean {
    return !isNaN(parseFloat(n)) && isFinite(n);
  }
}