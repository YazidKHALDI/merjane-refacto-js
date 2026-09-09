import {type Cradle} from '@fastify/awilix';
import {eq, sql} from 'drizzle-orm';
import {products} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export class ProductRepository {
	private readonly db: Database;

	public constructor({db}: Pick<Cradle, 'db'>) {
		this.db = db;
	}

	public async decrementStock(productId: number): Promise<void> {
		await this.db.update(products)
			.set({available: sql`${products.available} - 1`})
			.where(eq(products.id, productId));
	}

	public async markUnavailable(productId: number): Promise<void> {
		await this.db.update(products).set({available: 0}).where(eq(products.id, productId));
	}

	public async updateLeadTime(productId: number, leadTime: number): Promise<void> {
		await this.db.update(products).set({leadTime}).where(eq(products.id, productId));
	}
}
