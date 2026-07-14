import { TestBed } from '@angular/core/testing';

import { PreprocessingService } from './preprocessing';

describe('Preprocessing', () => {
  let service: PreprocessingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreprocessingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
