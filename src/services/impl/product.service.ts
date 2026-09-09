import {type Cradle} from '@fastify/awilix';
import {type INotificationService} from '../notifications.port.js';
import {type Product} from '@/db/schema.js';
import {type ProductRepository} from '@/repositories/product.repository.js';

export class ProductService {
	private readonly ns: INotificationService;
	private readonly productRepository: ProductRepository;

	public constructor({ns, productRepository}: Pick<Cradle, 'ns' | 'productRepository'>) {
		this.ns = ns;
		this.productRepository = productRepository;
	}

	public async processProduct(p: Product): Promise<void> {
		switch (p.type) {
			case 'NORMAL': {
				if (p.available > 0) {
					p.available -= 1;
					await this.productRepository.decrementStock(p.id);
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
				const seasonStartDate = this.requireDate(p, 'seasonStartDate');
				const seasonEndDate = this.requireDate(p, 'seasonEndDate');
				if (currentDate > seasonStartDate && currentDate < seasonEndDate && p.available > 0) {
					p.available -= 1;
					await this.productRepository.decrementStock(p.id);
				} else {
					await this.handleSeasonalProduct(p);
				}

				break;
			}

			case 'EXPIRABLE': {
				const currentDate = new Date();
				const expiryDate = this.requireDate(p, 'expiryDate');
				if (p.available > 0 && expiryDate > currentDate) {
					p.available -= 1;
					await this.productRepository.decrementStock(p.id);
				} else {
					await this.handleExpiredProduct(p);
				}

				break;
			}
		}
	}

	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		p.leadTime = leadTime;
		await this.productRepository.updateLeadTime(p.id, leadTime);
		this.ns.sendDelayNotification(leadTime, p.name);
	}

	public async handleSeasonalProduct(p: Product): Promise<void> {
		const currentDate = new Date();
		const seasonStartDate = this.requireDate(p, 'seasonStartDate');
		const seasonEndDate = this.requireDate(p, 'seasonEndDate');
		const d = 1000 * 60 * 60 * 24;
		const delayExceedsSeasonEnd = new Date(currentDate.getTime() + (p.leadTime * d)) > seasonEndDate;
		const seasonNotStartedYet = seasonStartDate > currentDate;

		if (delayExceedsSeasonEnd || seasonNotStartedYet) {
			this.ns.sendOutOfStockNotification(p.name);
			p.available = 0;
			await this.productRepository.markUnavailable(p.id);
		} else {
			await this.notifyDelay(p.leadTime, p);
		}
	}

	public async handleExpiredProduct(p: Product): Promise<void> {
		// Only reached from `processProduct` once the product is already known to be
		// out of stock or expired, so no further stock/expiry check is needed here.
		const expiryDate = this.requireDate(p, 'expiryDate');
		this.ns.sendExpirationNotification(p.name, expiryDate);
		p.available = 0;
		await this.productRepository.markUnavailable(p.id);
	}

	// Guards against a null date on a product whose type requires one — previously a bare
	// `!` assertion here would let a null slip through and silently corrupt the date math.
	private requireDate(p: Product, field: 'expiryDate' | 'seasonStartDate' | 'seasonEndDate'): Date {
		const value = p[field];
		if (value === null) {
			throw new Error(`Product ${p.id} (${p.name}, ${p.type}) is missing required field "${field}"`);
		}

		return value;
	}
}
