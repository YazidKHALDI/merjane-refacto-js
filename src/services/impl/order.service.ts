/* eslint-disable no-await-in-loop */
import {type Cradle} from '@fastify/awilix';
import createError from '@fastify/error';
import {eq} from 'drizzle-orm';
import {type ProductService} from './product.service.js';
import {orders, type Order} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

export const orderNotFoundError = createError('ORDER_NOT_FOUND', 'Order %s not found', 404);

export class OrderService {
	private readonly db: Database;
	private readonly productService: ProductService;

	public constructor({db, productService}: Pick<Cradle, 'db' | 'productService'>) {
		this.db = db;
		this.productService = productService;
	}

	public async processOrder(orderId: number): Promise<Order> {
		const order = await this.db.query.orders
			.findFirst({
				where: eq(orders.id, orderId),
				with: {
					products: {
						columns: {},
						with: {
							product: true,
						},
					},
				},
			});

		if (!order) {
			throw orderNotFoundError(orderId);
		}

		const {products: productList} = order;

		if (productList) {
			for (const {product: p} of productList) {
				await this.productService.processProduct(p);
			}
		}

		return order;
	}
}
