import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {mockDeep, type DeepMockProxy} from 'vitest-mock-extended';
import {type INotificationService} from '../notifications.port.js';
import {createDatabaseMock, cleanUp} from '../../utils/test-utils/database-tools.ts.js';
import {ProductService} from './product.service.js';
import {products, type Product} from '@/db/schema.js';
import {type Database} from '@/db/type.js';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

describe('ProductService Tests', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;
	let closeDatabase: () => void;

	beforeEach(async () => {
		({databaseMock, databaseName, close: closeDatabase} = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => {
		closeDatabase();
		await cleanUp(databaseName);
	});

	it('should handle delay notification correctly', async () => {
		// GIVEN
		const product: Product = {
			id: 1,
			leadTime: 15,
			available: 0,
			type: 'NORMAL',
			name: 'RJ45 Cable',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
		};
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN
		expect(product.available).toBe(0);
		expect(product.leadTime).toBe(15);
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(product.leadTime, product.name);
		const result = await databaseMock.query.products.findFirst({
			where: (product, {eq}) => eq(product.id, product.id),
		});
		expect(result).toEqual(product);
	});

	describe('handleSeasonalProduct', () => {
		it('marks the product unavailable when the lead time would push past the end of the season', async () => {
			// GIVEN
			const product: Product = {
				id: 2,
				leadTime: 5,
				available: 10,
				type: 'SEASONAL',
				name: 'Watermelon',
				expiryDate: null,
				seasonStartDate: new Date(Date.now() - (10 * ONE_DAY_MS)),
				seasonEndDate: new Date(Date.now() + (2 * ONE_DAY_MS)),
			};
			await databaseMock.insert(products).values(product);

			// WHEN
			await productService.handleSeasonalProduct(product);

			// THEN
			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(product.name);
		});

		it('marks the product unavailable when the season has not started yet', async () => {
			// GIVEN
			const product: Product = {
				id: 3,
				leadTime: 5,
				available: 10,
				type: 'SEASONAL',
				name: 'Grapes',
				expiryDate: null,
				seasonStartDate: new Date(Date.now() + (10 * ONE_DAY_MS)),
				seasonEndDate: new Date(Date.now() + (60 * ONE_DAY_MS)),
			};
			await databaseMock.insert(products).values(product);

			// WHEN
			await productService.handleSeasonalProduct(product);

			// THEN — treated the same as the "delay exceeds season end" case: unavailable
			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(product.name);
		});

		it('falls back to a delay notification when in season but out of stock', async () => {
			// GIVEN
			const product: Product = {
				id: 4,
				leadTime: 5,
				available: 0,
				type: 'SEASONAL',
				name: 'Strawberry',
				expiryDate: null,
				seasonStartDate: new Date(Date.now() - (10 * ONE_DAY_MS)),
				seasonEndDate: new Date(Date.now() + (60 * ONE_DAY_MS)),
			};
			await databaseMock.insert(products).values(product);

			// WHEN
			await productService.handleSeasonalProduct(product);

			// THEN
			expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(product.leadTime, product.name);
		});
	});

	describe('handleExpiredProduct', () => {
		// `processProduct` only calls this method once the product is already known to be
		// out of stock or expired, so the method is unconditional: it always notifies
		// expiration and zeroes stock.
		it('notifies expiration and zeroes stock once the product has expired', async () => {
			// GIVEN
			const product: Product = {
				id: 6,
				leadTime: 5,
				available: 3,
				type: 'EXPIRABLE',
				name: 'Milk',
				expiryDate: new Date(Date.now() - (2 * ONE_DAY_MS)),
				seasonStartDate: null,
				seasonEndDate: null,
			};
			await databaseMock.insert(products).values(product);

			// WHEN
			await productService.handleExpiredProduct(product);

			// THEN
			expect(product.available).toBe(0);
			expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(product.name, product.expiryDate);
		});
	});
});

