import passport from 'passport';
import querystring from 'querystring';
import autoBind from 'auto-bind';
import { Express, Request, Response, NextFunction, CookieOptions } from 'express';
import CookieStrategy from 'passport-cookie';
import { provide } from 'inversify-binding-decorators';
import { Cache } from '../cache';
import { AuthApi, User } from '@unicsmcr/hs_auth_client';
import { getConfig, Environment } from '../../util/config';
import { RouterInterface } from '../../routes';

export interface RequestAuthenticationInterface {
	passportSetup(app: Express): void;
	withAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
	handleUnauthorized(req: Request, res: Response): void;
	getUserAuthToken(req: Request): string;
}

type AuthMiddlewareFunction<T> = (req: Request, res: Response, next: NextFunction) => Promise<T>;
type ExpressOpHandlerFunction = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

@provide(RequestAuthentication)
export class RequestAuthentication {
	private readonly cookieName = 'Authorization';

	private readonly _cache: Cache;
	public readonly authApi: AuthApi;

	public constructor(cache: Cache) {
		this._cache = cache;
		this.authApi = new AuthApi('hs_apply');

		autoBind(this);
	}

	private logout(app: Express): void {
		let logoutCookieOptions: CookieOptions;
		if (app.get('env') === Environment.Production) {
			logoutCookieOptions = {
				domain: app.locals.settings.rootDomain,
				secure: true,
				httpOnly: true
			};
		}

		// When the user logs out we clear the authorization cookie and redirect
		app.get('/logout', (req: Request, res: Response) => {
			res.cookie('Authorization', '', logoutCookieOptions);
			return res.redirect('/');
		});
	}

	public passportSetup(app: Express): void {
		this.logout(app);

		app.use(passport.initialize());
		passport.use(
			new CookieStrategy(
				{
					cookieName: this.cookieName,
					passReqToCallback: true
				},
				// Defines the callback function which is executed after the cookie strategy is completed
				// We call the API endpoint on hs_auth to return the user based on the token
				async (req: Request, token: string, done: (error?: string, user?: any) => void): Promise<void> => {
					let apiResult: User;
					try {
						apiResult = await this.authApi.getCurrentUser(token);
					} catch (err) {
						return done(undefined, undefined);
					}

					return done(undefined, apiResult);
				}
			)
		);
	}

	private authenticate(req: Request, res: Response): Promise<User> {
		return new Promise((resolve, reject) => {
			passport.authenticate('cookie', { session: false }, (err: any, user?: User) => {
				if (err) reject(new Error(err));
				else if (!user) reject(new Error('Not authenticated'));
				resolve(user);
			})(req, res);
		});
	}

	public withAuthMiddleware(router: RouterInterface, operationHandler: ExpressOpHandlerFunction): AuthMiddlewareFunction<unknown> {
		return async (req: Request, res: Response, next: NextFunction): Promise<unknown> => {
			const userAuth = this.authenticate(req, res);

			const requestedUri = this.getUriFromRequest(router, operationHandler, req);
			const resourceAuth = this.authApi.getAuthorizedResources(this.getUserAuthToken(req), [requestedUri]);

			try {
				const [user, permissions] = await Promise.all([userAuth, resourceAuth]);
				if (permissions.length === 0) {
					return this.handleUnauthorized(req, res);
				}
				req.user = user;
			} catch (err) {
				return this.handleUnauthorized(req, res);
			}

			return operationHandler(req, res, next);
		};
	}

	public handleUnauthorized(req: Request, res: Response): void {
		const queryParam: string = querystring.encode({ returnto: `${getConfig().hs.applicationUrl}${req.originalUrl}` });
		res.redirect(`${getConfig().hs.authUrl}/login?${queryParam}`);
	}

	public getUserAuthToken(req: Request): string {
		return req.cookies[this.cookieName];
	}

	private getUriFromRequest(router: RouterInterface, operationHandler: ExpressOpHandlerFunction, req: Request): string {
		const routerName = Reflect.getPrototypeOf(router).constructor.name.replace('Router', '');
		const opHandlerParts = operationHandler.name.split(' ');
		const opHandlerName = opHandlerParts[opHandlerParts.length - 1];

		const args = new Map();

		// Request path parameters
		for (const [key, val] of Object.entries(req.params)) {
			args.set(`path_${key}`, val);
		}

		// Request form parameters
		for (const [key, val] of Object.entries(req.query)) {
			args.set(`query_${key}`, val);
		}

		// Request form parameters
		for (const [key, val] of Object.entries(req.body)) {
			args.set(`postForm_${key}`, val);
		}

		return this.authApi.newUri(`${routerName}:${opHandlerName}`, args);
	}
}
