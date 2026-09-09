/* eslint-disable @typescript-eslint/switch-exhaustiveness-check */
import {type Cradle} from '@fastify/awilix';
import {eq} from 'drizzle-orm';
import {type INotificationService} from '../notifications.port.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class ProductService {
	private readonly ns: INotificationService;
	private readonly db: Database;

	public constructor({ns, db}: Pick<Cradle, 'ns' | 'db'>) {
		this.ns = ns;
		this.db = db;
	}

	public async processProduct(p: Product): Promise<void> {
		switch (p.type) {
			case 'NORMAL': {
				if (p.available > 0) {
					p.available -= 1;
					await this.db.update(products).set(p).where(eq(products.id, p.id));
				} else {
					const {leadTime} = p;
					if (leadTime > 0) {
						await this.notifyDelay(leadTime, p);
					}
				}

				break;
			}

			case 'SEASONAL': {
				const currentDate = new Date();
				if (currentDate > p.seasonStartDate! && currentDate < p.seasonEndDate! && p.available > 0) {
					p.available -= 1;
					await this.db.update(products).set(p).where(eq(products.id, p.id));
				} else {
					await this.handleSeasonalProduct(p);
				}

				break;
			}

			case 'EXPIRABLE': {
				const currentDate = new Date();
				if (p.available > 0 && p.expiryDate! > currentDate) {
					p.available -= 1;
					await this.db.update(products).set(p).where(eq(products.id, p.id));
				} else {
					await this.handleExpiredProduct(p);
				}

				break;
			}
		}
	}

	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		p.leadTime = leadTime;
		await this.db.update(products).set(p).where(eq(products.id, p.id));
		this.ns.sendDelayNotification(leadTime, p.name);
	}

	public async handleSeasonalProduct(p: Product): Promise<void> {
		const currentDate = new Date();
		const d = 1000 * 60 * 60 * 24;
		const delayExceedsSeasonEnd = new Date(currentDate.getTime() + (p.leadTime * d)) > p.seasonEndDate!;
		const seasonNotStartedYet = p.seasonStartDate! > currentDate;

		if (delayExceedsSeasonEnd || seasonNotStartedYet) {
			this.ns.sendOutOfStockNotification(p.name);
			p.available = 0;
			await this.db.update(products).set(p).where(eq(products.id, p.id));
		} else {
			await this.notifyDelay(p.leadTime, p);
		}
	}

	public async handleExpiredProduct(p: Product): Promise<void> {
		// Only reached from `processProduct` once the product is already known to be
		// out of stock or expired, so no further stock/expiry check is needed here.
		this.ns.sendExpirationNotification(p.name, p.expiryDate!);
		p.available = 0;
		await this.db.update(products).set(p).where(eq(products.id, p.id));
	}
}
