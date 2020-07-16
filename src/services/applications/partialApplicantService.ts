import { injectable, inject } from 'inversify';
import { PartialApplicant } from '../../models/db/applicant';
import { PartialApplicantRepository } from '../../repositories';
import { TYPES } from '../../types';
import { ObjectID, Repository } from 'typeorm';
import { logger } from '../../util';

type ApplicationID = string | number | Date | ObjectID;

export interface PartialApplicantServiceInterface {
	find: (id: ApplicationID, findBy?: keyof PartialApplicant) => Promise<PartialApplicant>;
	save: (id: string, newApplicants: Record<string, string>, file?: Buffer) => Promise<void>;
	remove: (id: string) => Promise<void>;
}

@injectable()
export class PartialApplicantService implements PartialApplicantServiceInterface {
	private readonly _partialApplicantRepository: Repository<PartialApplicant>;

	public constructor(
	@inject(TYPES.PartialApplicantRepository) partialApplicantRepository: PartialApplicantRepository
	) {
		this._partialApplicantRepository = partialApplicantRepository.getRepository();
	}

	public find = async (id: ApplicationID, findBy?: keyof PartialApplicant): Promise<PartialApplicant> => {
		try {
			const findColumn: keyof PartialApplicant = findBy ?? 'authId';
			const partialApplicant = await this._partialApplicantRepository.findOne({ [findColumn]: id });
			if (!partialApplicant) throw new Error('Applicant does not exist');
			return partialApplicant;
		} catch (err) {
			throw new Error(`Failed to find an applicant:\n${(err as Error).message}`);
		}
	};

	public remove = async (id: string): Promise<void> => {
		try {
			await this._partialApplicantRepository.delete(id);
		} catch (err) {
			throw new Error(`Failed to remove partial application. ${(err as Error).message}`);
		}
	};

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public save = async (id: string, rawApplication: Record<string, string>, _file?: Buffer): Promise<void> => {
		const application = new PartialApplicant();
		application.authId = id;
		application.partialApplication = { ...rawApplication };

		// let questionName;
		// for (const [name, options] of applicationMapping.entries()) {
		// 	application.partialApplication[name] = rawApplication[name];
		// }

		try {
			await this._partialApplicantRepository.save(application);
		} catch (err) {
			logger.error(err);
		}
	};
}